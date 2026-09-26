import { DistributedRequestError } from './DistributedHttpTransport.ts';
import type { CommandTarget } from './DurableCommandClient.ts';
import { discoverDeliveryStreams } from './DurableDeliveryClient.ts';
import type { StreamCatalogPage } from './DurableDeliveryClient.ts';
import { loadSequencedHistory } from './DistributedViews.ts';
export type HistoryItem = { id: string; sequence: number; [key: string]: unknown };
export type LegacyCursor = { at: string; id: string };
export type LegacyPage = { source: 'legacy'; items: { id: string; [key: string]: unknown }[]; next_before: LegacyCursor | null };
export type CatalogRoom = {room_id:string;name:string;creator_id:string;visibility:string;created_at:string;open_table_count:number;is_member:boolean};
export type TableInvitation = {id:string;room_id:string;room_name:string;table_id:string;table_name:string;table_revision:number;match_id:string};

// Read routes never mutate game state or advance delivery ACKs. Caller owns the
// authenticated lifetime and passes bounded session operation AbortSignals.
export class DistributedReadClient {
  private base: string; private token: string; private fetcher: typeof fetch;
  constructor(base: string, token: string, fetcher: typeof fetch = globalThis.fetch) {
    this.base = base.replace(/\/$/, ''); this.token = token; this.fetcher = fetcher.bind(globalThis);
  }
  private async request<T>(path: string, signal: AbortSignal, body?: object): Promise<T> {
    const abort = new AbortController(), cancel = () => abort.abort();
    signal.addEventListener('abort',cancel,{once:true});
    if(signal.aborted)cancel();
    const timer=setTimeout(cancel,10000);
    try {
    const result = await this.fetcher(this.base + path, { signal:abort.signal, cache:'no-store',
      method:body === undefined ? 'GET':'POST', headers:{Authorization:`Bearer ${this.token}`,'Content-Type':'application/json'},
      ...(body === undefined ? {} : {body:JSON.stringify(body)}) });
    if (!result.ok) throw new DistributedRequestError(result.status);
    return await result.json();
    } finally {clearTimeout(timer);signal.removeEventListener('abort',cancel);}
  }
  room<T>(room: string, table: string | null, signal: AbortSignal): Promise<T> {
    return this.request(`/rooms/${encodeURIComponent(room)}${table ? `?table_id=${encodeURIComponent(table)}` : ''}`, signal);
  }
  catalog(after: string | null, signal: AbortSignal) {
    return this.request<{items:CatalogRoom[];next_room_id:string|null}>(`/rooms?limit=50${after ? `&after_room_id=${encodeURIComponent(after)}`:''}`,signal);
  }
  members(room: string, after: string | null, signal: AbortSignal) {
    return this.request<{items:string[];next_user_id:string|null}>(`/rooms/${encodeURIComponent(room)}/members?limit=100${after ? `&after_user_id=${encodeURIComponent(after)}`:''}`,signal);
  }
  roomInvitations(after: string | null, signal: AbortSignal) {
    return this.request<{items:{id:string;room_id:string;room_name:string;inviter_id:string;status:string}[];next_id:string|null}>(`/room-invitations?limit=50${after ? `&after_id=${encodeURIComponent(after)}`:''}`,signal);
  }
  tableInvitations(after: string | null, signal: AbortSignal) {
    return this.request<{items:TableInvitation[];next_table_id:string|null}>(`/table-invitations?limit=50${after ? `&after_table_id=${encodeURIComponent(after)}`:''}`,signal);
  }
  ledger<T>(room: string, signal: AbortSignal): Promise<T> {
    return this.request(`/rooms/${encodeURIComponent(room)}/ledger`,signal);
  }
  recipient(signal: AbortSignal) { return this.request<{lane_id:string;target:CommandTarget}>('/streams/recipient',signal,{}); }
  open(target: CommandTarget, signal: AbortSignal) {
    return this.request<{lane_id:string;target:CommandTarget}>('/streams/open',signal,target);
  }
  socialStreams(after: string | null, signal: AbortSignal): Promise<StreamCatalogPage> {
    return this.request(`/streams/social${after ? `?after=${encodeURIComponent(after)}`:''}`,signal);
  }
  history(family: 'chat'|'social', lane: string, signal: AbortSignal) {
    return loadSequencedHistory<HistoryItem>(after => this.request(`/history/${family}/${encodeURIComponent(lane)}?after=${after}`,signal),signal);
  }
  async discover(selected: CommandTarget[], signal: AbortSignal): Promise<StreamCatalogPage> {
    if (selected.length > 16) throw Error('Selected stream bound exceeded.');
    const recipient = await this.recipient(signal);
    const lanes = new Set(await discoverDeliveryStreams((after, s) => this.socialStreams(after, s), signal));
    lanes.add(recipient.lane_id);
    for (const target of selected) {
      if (signal.aborted) throw Error('Stream discovery aborted.');
      const opened = await this.open(target, signal); lanes.add(opened.lane_id);
    }
    if (signal.aborted || lanes.size > 128 || [...lanes].some(lane => typeof lane !== 'string' || !lane)) {
      throw Error('Invalid or oversized stream catalog.');
    }
    return { items: [...lanes].sort().map(lane_id => ({lane_id})), next_lane_id: null };
  }
  // Legacy is deliberately paged separately; no invented sequence or ACK cursor.
  legacy(family: 'direct'|'notifications', other: string | null, before: LegacyCursor | null, signal: AbortSignal): Promise<LegacyPage> {
    const query = new URLSearchParams();
    if (other) query.set('other',other);
    if (before) { query.set('before_at',before.at);query.set('before_id',before.id); }
    return this.request(`/legacy/${family}?${query}`,signal);
  }
}
