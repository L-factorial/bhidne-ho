import { DistributedRequestError } from './DistributedHttpTransport.ts';
import type { CommandTarget } from './DurableCommandClient.ts';
import { discoverDeliveryStreams } from './DurableDeliveryClient.ts';
import type { StreamCatalogPage } from './DurableDeliveryClient.ts';
import { loadSequencedHistory } from './DistributedViews.ts';
import type { Room } from './session';
export type HistoryItem = { id: string; sequence: number; [key: string]: unknown };
export type LegacyCursor = { at: string; id: string };
export type LegacyPage = { source: 'legacy'; items: { id: string; [key: string]: unknown }[]; next_before: LegacyCursor | null };
export type CatalogRoom = {room_id:string;name:string;creator_id:string;visibility:string;created_at:string;open_table_count:number;is_member:boolean};
export type MemberProfile = {user_id:string;display_name:string;username:string|null};
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
    if (!result.ok) {
      let message:string|undefined;
      try {const body=await result.json();if(typeof body.detail==='string')message=body.detail;}catch {}
      throw new DistributedRequestError(result.status,message ?? `Distributed read failed (${result.status}).`);
    }
    return await result.json();
    } finally {clearTimeout(timer);signal.removeEventListener('abort',cancel);}
  }
  room<T>(room: string, table: string | null, signal: AbortSignal): Promise<T> {
    return this.request(`/rooms/${encodeURIComponent(room)}${table ? `?table_id=${encodeURIComponent(table)}` : ''}`, signal);
  }
  gameView<T>(room: string, match: string | null, signal: AbortSignal): Promise<T> {
    return this.request(`/ui/rooms/${encodeURIComponent(room)}/game${match ? `?match_id=${encodeURIComponent(match)}` : ''}`,signal);
  }
  preview<T extends Room>(room: string, signal: AbortSignal): Promise<T> {
    return this.request(`/ui/rooms/${encodeURIComponent(room)}`,signal);
  }
  eligibility(room: string, player_ids: string[], signal: AbortSignal) {
    return this.request(`/ui/rooms/${encodeURIComponent(room)}/invitation-eligibility`,signal,{player_ids});
  }
  async memberProfiles(room: string, signal: AbortSignal): Promise<MemberProfile[]> {
    const items: MemberProfile[] = [], seen = new Set<string>();
    let after: string | null = null;
    for (let page = 0; page < 10; page++) {
      const result: {items:MemberProfile[];next_user_id:string|null} = await this.request(
        `/ui/rooms/${encodeURIComponent(room)}/members${after ? `?after_user_id=${encodeURIComponent(after)}` : ''}`,signal);
      if (signal.aborted) throw Error('Member load aborted.');
      if (!Array.isArray(result.items) || result.items.length > 100) throw Error('Invalid member profile page.');
      for (const profile of result.items) {
        if (!profile.user_id || seen.has(profile.user_id)) throw Error('Repeated member profile.');
        seen.add(profile.user_id); items.push(profile);
      }
      if (result.next_user_id === null) return items;
      if (!result.items.length || result.next_user_id !== result.items.at(-1)?.user_id
          || (after !== null && result.next_user_id <= after)) throw Error('Invalid member profile cursor.');
      after = result.next_user_id;
    }
    throw Error('Room exceeds the supported membership limit.');
  }
  catalog(after: string | null, signal: AbortSignal) {
    return this.request<{items:CatalogRoom[];next_room_id:string|null}>(`/rooms?limit=50${after ? `&after_room_id=${encodeURIComponent(after)}`:''}`,signal);
  }
  async lobby(signal: AbortSignal): Promise<Room[]> {
    const rooms: Room[] = [], seen = new Set<string>();
    let after: string | null = null;
    // Fail visibly instead of displaying a silently truncated original lobby.
    for (let page = 0; page < 100; page++) {
      const result: {items: Room[]; next_room_id: string | null} = await this.request(
        `/ui/rooms?limit=100${after ? `&after_room_id=${encodeURIComponent(after)}` : ''}`, signal);
      if (signal.aborted) throw Error('Lobby load aborted.');
      if (!Array.isArray(result.items) || result.items.length > 100) throw Error('Invalid lobby page.');
      for (const room of result.items) {
        if (!room.room_id || seen.has(room.room_id)) throw Error('Repeated lobby room.');
        seen.add(room.room_id); rooms.push(room);
      }
      if (result.next_room_id === null) {
        const rank = {you:0, joined:1, friend:2, public:3};
        return rooms.sort((a,b) => rank[a.feed_source ?? 'public'] - rank[b.feed_source ?? 'public']
          || (b.created_at ?? 0) - (a.created_at ?? 0) || a.room_id.localeCompare(b.room_id));
      }
      if (!result.items.length || result.next_room_id !== result.items.at(-1)?.room_id
          || (after !== null && result.next_room_id <= after)) throw Error('Invalid lobby cursor.');
      after = result.next_room_id;
    }
    throw Error('Lobby exceeds the supported room limit.');
  }
  async activity<T>(kind: 'memberships'|'active-tables', signal: AbortSignal): Promise<T[]> {
    const items: T[] = [];
    let after: string | null = null;
    for (let page = 0; page < 500; page++) {
      const result: {items:T[];next_room_id:string|null} = await this.request(
        `/ui/${kind}${after ? `?after_room_id=${encodeURIComponent(after)}` : ''}`,signal);
      if (signal.aborted) throw Error('Activity load aborted.');
      if (!Array.isArray(result.items) || result.items.length > 100) throw Error('Invalid activity page.');
      items.push(...result.items);
      if (result.next_room_id === null) return items;
      // A page can have no tables, while still advancing over rooms.
      if (typeof result.next_room_id !== 'string' || !result.next_room_id
          || (after !== null && result.next_room_id <= after)) throw Error('Invalid activity cursor.');
      after = result.next_room_id;
    }
    throw Error('Activity exceeds the supported room limit.');
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
