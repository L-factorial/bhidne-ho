import { DistributedScreenController } from './DistributedScreenController.ts';
import { OwnedSession } from './JournalOwner.ts';
import type { AcquireJournal, JournalOwner } from './JournalOwner.ts';
import { DistributedSession } from './DistributedSession.ts';
import { DistributedReadClient } from './DistributedReadClient.ts';
import { distributedHttpTransport, DistributedRequestError } from './DistributedHttpTransport.ts';
import { DistributedSocketTransport } from './DistributedSocketTransport.ts';
import { boundedDelivery, discoverDeliveryStreams } from './DurableDeliveryClient.ts';
import type { CommandTarget } from './DurableCommandClient.ts';
import type { SelectedTable } from './DistributedControls.ts';
import { gameControl, tableControl, roomControl } from './DistributedControls.ts';

export type Selection = { room: string; table: string | null; chat?: ('room_chat'|'table_chat'|'game_chat')[] };
type Projection = { room_id: string; snapshot: (SelectedTable & { durable_game_id: string | null }) | null };
export type RootView = { kind: 'snapshot'; value: Projection } | { kind: 'chat'|'social'; value: unknown };
type SocketFactory = (url: string, token: string, device: string, disconnected: () => void) => DistributedSocketTransport;
export type RootCallbacks = {
  install(lane: string, value: RootView): void; remove(lane: string): void;
  error(lane: string | null, error: unknown): void;
  transient?(payload: unknown): void;
};
const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v));

// Explicit app-root composition, not mounted in legacy React screens. One runtime
// owns the persistent command session; sockets/selections are replaceable children.
export class DistributedRootRuntime {
  readonly session: DistributedSession<RootView>;
  readonly reads: DistributedReadClient;
  private socket: DistributedSocketTransport | null = null;
  private selection: Selection | null = null;
  private targets = new Map<string, CommandTarget>();
  private projection: Projection | null = null;
  private snapshotTail: Promise<void> = Promise.resolve();
  private generation = 0;
  private closed = false;
  private retry?: ReturnType<typeof setTimeout>;
  private attempts = 0;
  private owner: JournalOwner;
  private base: string;
  private token: string;
  private socketFactory: SocketFactory;
  private callbacks: RootCallbacks;

  constructor(owner: JournalOwner, base: string, token: string, callbacks: RootCallbacks,
    options: { fetcher?: typeof fetch; socketFactory?: SocketFactory; refreshMs?: number } = {}) {
    this.owner = owner; this.base = base.replace(/\/$/, ''); this.token = token;
    this.callbacks = callbacks;
    this.socketFactory = options.socketFactory ?? ((...args) => new DistributedSocketTransport(...args));
    this.reads = new DistributedReadClient(this.base, token, options.fetcher);
    this.session = new DistributedSession(owner.clientId, {
      commands: distributedHttpTransport(this.base, token, options.fetcher),
      discover: (_after, signal) => this.discover(signal),
      open: (...args) => {
        if (!this.socket) return Promise.reject(Error('Delivery connection unavailable.'));
        return this.socket.open(...args);
      },
      load: (lane, signal) => this.load(lane, signal),
    }, {
      install: (lane, view) => this.install(lane, view),
      remove: lane => {
        if (['room','table'].includes(this.targets.get(lane)?.kind ?? '')) this.projection = null;
        callbacks.remove(lane);
      },
      error: (lane, error) => {
        if (error instanceof DistributedRequestError && error.status === 401) {
          this.close(); this.owner.close();
        }
        callbacks.error(lane, error);
      },
      transient: events => { if(!this.closed) for(const event of events) callbacks.transient?.(event.payload); },
    }, { ...(options.refreshMs === undefined ? {} : {refreshMs:options.refreshMs}) }, owner.journal);
  }
  private async discover(signal: AbortSignal) {
    const selected = copy(this.selection), generation = this.generation;
    const targets = new Map<string, CommandTarget>();
    const recipient = await this.reads.recipient(signal); targets.set(recipient.lane_id, recipient.target);
    const social = await discoverDeliveryStreams((after,s) => this.reads.socialStreams(after,s),signal);
    for (const lane of social) if (!targets.has(lane)) targets.set(lane,{kind:'conversation'});
    const open = async (target: CommandTarget) => {
      const stream = await this.reads.open(target,signal); targets.set(stream.lane_id,target);
    };
    if (selected) {
      const projection = await this.reads.room<Projection>(selected.room,selected.table,signal);
      this.validateProjection(projection, selected);
      await open({kind:'room',room_id:selected.room});
      const table = projection.snapshot;
      if (table) {
        await open({kind:'table',room_id:selected.room,table_id:table.table_id});
        if (table.durable_game_id) await open({kind:'game',room_id:selected.room,table_id:table.table_id,game_id:table.durable_game_id});
      }
      for (const kind of selected.chat ?? []) {
        const target: CommandTarget = {kind,room_id:selected.room};
        if (kind !== 'room_chat') {
          if (!table) throw Error('Chat needs a selected table.');
          target.table_id = table.table_id;
        }
        if (kind === 'game_chat') {
          if (!table?.durable_game_id) throw Error('Chat needs a selected game.');
          target.game_id = table.durable_game_id;
        }
        try { await open(target); }
        catch (error) {
          // Chat may be paused during active play or unavailable to spectators.
          // An optional chat scope must not prevent the authorized game snapshot
          // from loading. Transport/authentication failures still fail discovery.
          if (!(error instanceof DistributedRequestError && error.status === 403)) throw error;
        }
      }
    }
    if (signal.aborted || generation !== this.generation) throw Error('Obsolete selection discovery.');
    if (targets.size > 128) throw Error('Selected stream bound exceeded.');
    this.targets = targets;
    return {items:[...targets.keys()].sort().map(lane_id=>({lane_id})),next_lane_id:null};
  }
  private validateProjection(value: Projection, selected: Selection) {
    if (!value || value.room_id !== selected.room || (selected.table && value.snapshot?.table_id?.replaceAll('-','') !== selected.table.replaceAll('-',''))) {
      throw Error('Snapshot does not match the selected scope.');
    }
    if (value.snapshot && (!Number.isSafeInteger(value.snapshot.table_revision) || value.snapshot.table_revision < 0
        || (value.snapshot.game && (!Number.isSafeInteger(value.snapshot.game.revision) || value.snapshot.game.revision < 0)))) {
      throw Error('Snapshot has invalid revisions.');
    }
  }
  private async load(lane: string, signal: AbortSignal): Promise<RootView> {
    const target = this.targets.get(lane);
    if (!target) throw Error('Undiscovered stream.');
    if (['room','table','game'].includes(target.kind)) {
      const selected = copy(this.selection);
      if (!selected) throw Error('No selected hosted view.');
      // Serialize primary snapshot reads across hosted lanes sharing one screen.
      // A delayed older lane must not overwrite a later match/round projection.
      const prior = this.snapshotTail;
      let release!: () => void;
      this.snapshotTail = new Promise<void>(resolve => { release = resolve; });
      try {
        await prior;
        if (signal.aborted) throw Error('Obsolete snapshot load.');
        const controller = new AbortController(), abort = () => controller.abort();
        signal.addEventListener('abort',abort,{once:true});
        try {
          const value = await boundedDelivery(controller,10000,() => this.reads.room<Projection>(selected.room,selected.table,controller.signal));
          this.validateProjection(value, selected); return {kind:'snapshot',value};
        } finally { signal.removeEventListener('abort',abort); }
      } finally { release(); }
    }
    const kind = target.kind.endsWith('_chat') ? 'chat':'social';
    return {kind,value:await this.reads.history(kind,lane,signal)};
  }
  private install(lane: string, view: RootView) {
    if (this.closed) return;
    if (view.kind === 'snapshot') {
      const selected = this.selection;
      if (!selected) return;
      this.validateProjection(view.value, selected);
      const old = this.projection?.snapshot, next = view.value.snapshot;
      if (old && next && (next.table_revision < old.table_revision
          || (next.durable_game_id === old.durable_game_id && next.game && old.game && next.game.revision < old.game.revision))) return;
      this.projection = copy(view.value);
    }
    this.callbacks.install(lane,copy(view));
  }
  async select(selection: Selection | null) {
    if (selection && (!selection.room || (selection.chat?.length ?? 0) > 3)) throw Error('Invalid selection.');
    this.selection = copy(selection); this.projection = null;
    await this.reconnect();
  }
  async reconnect(): Promise<void> {
    if (this.closed) throw Error('Root session closed.');
    clearTimeout(this.retry);
    const generation = ++this.generation;
    this.session.disconnect(); this.socket?.close(); this.socket = null; this.targets.clear(); this.projection = null;
    const failed = () => {
      if (this.closed || generation !== this.generation) return;
      this.generation++; this.session.disconnect(); this.socket?.close(); this.socket = null;
      this.retry = setTimeout(() => { void this.reconnect().catch(e=>this.callbacks.error(null,e)); },Math.min(1000*2**this.attempts++,8000));
    };
    try {
      const socket = this.socketFactory(this.base.replace(/^http/,'ws')+'/delivery',this.token,this.owner.clientId,failed);
      if (this.closed || generation !== this.generation) { socket.close(); return; }
      this.socket = socket;
      await this.session.connect();
    } catch (error) { failed(); throw error; }
  }
  screen(slot: string, callbacks: ConstructorParameters<typeof DistributedScreenController>[1]) {
    return new DistributedScreenController(this.session.command(slot),callbacks);
  }
  game(slot: string, command: string, payload: Parameters<typeof gameControl>[3] = {}) {
    const view = this.selectedTable(); return gameControl(this.session.command(slot),view,command,payload);
  }
  table(slot: string, command: string, payload: Parameters<typeof tableControl>[3] = {}) {
    return tableControl(this.session.command(slot),this.selectedTable(),command,payload);
  }
  room(slot: string, command: string, payload: Parameters<typeof roomControl>[3] = {}) {
    if (!this.selection) throw Error('No room selected.');
    return roomControl(this.session.command(slot),this.selection.room,command,payload);
  }
  private selectedTable(): SelectedTable {
    const snapshot = this.projection?.snapshot;
    if (!snapshot || !this.selection) throw Error('Wait for the selected table snapshot.');
    return {...copy(snapshot),room_id:this.selection.room};
  }
  close() {
    if (this.closed) return;
    this.closed = true; this.generation++;clearTimeout(this.retry);
    this.session.close(); this.socket?.close(); this.socket = null;this.targets.clear();this.projection = null;
  }
}

export function distributedRoot(acquire: AcquireJournal) { return new OwnedSession<DistributedRootRuntime>(acquire); }
