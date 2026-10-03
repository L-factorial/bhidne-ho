import { SnapshotRefreshClock } from './SnapshotRefreshClock.ts';
import { CoalescedRead } from './CoalescedRead.ts';
import { DistributedScreenController } from './DistributedScreenController.ts';
import { OwnedSession } from './JournalOwner.ts';
import type { AcquireJournal, JournalOwner } from './JournalOwner.ts';
import { DistributedSession } from './DistributedSession.ts';
import { DistributedReadClient } from './DistributedReadClient.ts';
import { distributedHttpTransport, DistributedRequestError } from './DistributedHttpTransport.ts';
import { DistributedSocketTransport } from './DistributedSocketTransport.ts';
import type { SocketDisconnect } from './DistributedSocketTransport.ts';
import { discoverDeliveryStreams } from './DurableDeliveryClient.ts';
import type { CommandTarget } from './DurableCommandClient.ts';
import type { SelectedTable } from './DistributedControls.ts';
import { gameControl, tableControl, roomControl } from './DistributedControls.ts';

export type Selection = { room: string; table: string | null; chat?: ('room_chat'|'table_chat'|'game_chat')[] };
export type Projection = { room_id: string; snapshot: (SelectedTable & { durable_game_id: string | null; status?: string }) | null };
type GameReadView = Partial<SelectedTable> & {room_id: string; status?: string; [key: string]: unknown};
export type RootView = {kind:'lobby';value:null} | { kind: 'snapshot'; value: Projection } | { kind: 'chat'|'social'; value: unknown };
type SocketFactory = (url: string, token: string, device: string, disconnected: (detail?: SocketDisconnect) => void, ready?: () => void) => DistributedSocketTransport;
export type RootCallbacks = {
  install(lane: string, value: RootView): void; remove(lane: string): void;
  error(lane: string | null, error: unknown, source?: 'command' | 'delivery' | 'connection'): void;
  transient?(payload: unknown): void;
  health?(ready: boolean): void;
  recovery?(kind: 'snapshot' | 'chat' | 'social' | null): void;
};
const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v));

// Explicit app-root composition, not mounted in legacy React screens. One runtime
// owns the persistent command session; sockets/selections are replaceable children.
export class DistributedRootRuntime {
  readonly session: DistributedSession<RootView>;
  readonly reads: DistributedReadClient;
  readonly snapshotClock = new SnapshotRefreshClock();
  private gameReads = new Map<string, CoalescedRead<GameReadView>>();
  private socket: DistributedSocketTransport | null = null;
  private selection: Selection | null = null;
  private targets = new Map<string, CommandTarget>();
  private projection: Projection | null = null;
  private streamReady = new Map<string, boolean>();
  private discoveryIssues: ('chat' | 'social')[] = [];
  private activityObservers = new Set<() => void>();
  observeActivity(listener: () => void) {
    this.activityObservers.add(listener);
    return () => {this.activityObservers.delete(listener);};
  }
  private observers = new Set<(view: Projection) => void>();
  observeSnapshot(listener: (view: Projection) => void) {
    this.observers.add(listener);
    if (this.projection) listener(copy(this.projection));
    return () => { this.observers.delete(listener); };
  }
  private snapshotRead: CoalescedRead<Projection> | null = null;
  private generation = 0;
  private selectionGeneration = 0;
  private connecting: Promise<void> | null = null;
  readonly connectionDiagnostics: (SocketDisconnect & {at: number})[] = [];
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
    this.socketFactory = options.socketFactory ?? ((url, token, device, failed, ready) => new DistributedSocketTransport(url, token, device, failed, undefined, ready));
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
        callbacks.remove(lane);
      },
      error: (lane, error, source) => {
        if (error instanceof DistributedRequestError && error.status === 401) {
          this.close(); this.owner.close();
        }
        callbacks.error(lane, error, source);
        if(error instanceof DistributedRequestError && [403,404].includes(error.status))for(const listener of this.activityObservers)listener();
      },
      transient: events => { if(!this.closed) for(const event of events) callbacks.transient?.(event.payload); },
      streamHealth: (lane, ready) => {
        this.streamReady.set(lane,ready); this.reportRecovery();
      },
      health: ready => { if(ready){for(const lane of this.streamReady.keys())this.streamReady.set(lane,true);}this.reportRecovery(); },
    }, {refreshMs:options.refreshMs ?? 30000}, owner.journal);
  }
  private async discover(signal: AbortSignal) {
    const selected = copy(this.selection), generation = this.selectionGeneration;
    const targets = new Map<string, CommandTarget>();
    const issues: ('chat' | 'social')[] = [];
    const recipient = await this.reads.recipient(signal); targets.set(recipient.lane_id, recipient.target);
    try {
      const social = await discoverDeliveryStreams((after,s) => this.reads.socialStreams(after,s),signal);
      for (const lane of social) if (!targets.has(lane)) targets.set(lane,{kind:'conversation'});
    } catch(error) {
      if(signal.aborted || error instanceof DistributedRequestError && error.status===401)throw error;
      issues.push('social');
      for(const [lane,target] of this.targets)if(target.kind==='conversation')targets.set(lane,target);
      this.callbacks.error(null,error,'delivery');
    }
    const open = async (target: CommandTarget) => {
      const stream = await this.reads.open(target,signal); targets.set(stream.lane_id,target);
    };
    await open({kind:'lobby'});
    if (selected) {
      const projection = this.projection ?? await this.readSelectedProjection(signal, false);
      this.validateProjection(projection, selected);
      await open({kind:'room',room_id:selected.room});
      const table = projection.snapshot;
      if (table && table.status!=='ended') {
        await open({kind:'table',room_id:selected.room,table_id:table.table_id});
        if (table.durable_game_id) await open({kind:'game',room_id:selected.room,table_id:table.table_id,game_id:table.durable_game_id});
      }
      for (const kind of selected.chat ?? []) {
        if(kind!=='room_chat' && table?.status==='ended')continue;
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
          if(signal.aborted || error instanceof DistributedRequestError && error.status===401)throw error;
          if (!(error instanceof DistributedRequestError && error.status === 403)) {
            issues.push('chat');
            for(const [lane,old] of this.targets)if(JSON.stringify(old)===JSON.stringify(target))targets.set(lane,old);
            this.callbacks.error(null,error,'delivery');
          }
        }
      }
    }
    if (signal.aborted || generation !== this.selectionGeneration) throw Error('Obsolete selection discovery.');
    if (targets.size > 128) throw Error('Selected stream bound exceeded.');
    this.targets = targets;
    for(const lane of this.streamReady.keys())if(!targets.has(lane))this.streamReady.delete(lane);
    this.discoveryIssues=issues;
    if(issues.length)this.session.retryDiscovery();
    this.reportRecovery();
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
    if (target.kind === 'lobby') return {kind:'lobby',value:null};
    if (['room','table','game'].includes(target.kind)) {
      return {kind:'snapshot',value:await this.readSelectedProjection(signal)};
    }
    const kind = target.kind.endsWith('_chat') ? 'chat':'social';
    return {kind,value:await this.reads.history(kind,lane,signal)};
  }
  private install(lane: string, view: RootView, notifyLane = true) {
    if (this.closed) return;
    if (view.kind === 'snapshot') {
      const selected = this.selection;
      if (!selected || view.value.room_id !== selected.room
          || (selected.table && view.value.snapshot?.table_id?.replaceAll('-','') !== selected.table.replaceAll('-',''))) return;
      this.validateProjection(view.value, selected);
      const old = this.projection?.snapshot, next = view.value.snapshot;
      if (old && next && (next.table_revision < old.table_revision
          || (next.durable_game_id === old.durable_game_id && next.game && old.game && next.game.revision < old.game.revision))) return;
      this.projection = copy(view.value);
      if(old && next && old.durable_game_id!==next.durable_game_id)this.session.retryDiscovery(50);
      for (const listener of this.observers) listener(copy(view.value));
    }
    if(notifyLane)this.callbacks.install(lane,copy(view));
    if(view.kind==='lobby'||view.kind==='social')for(const listener of this.activityObservers)listener();
  }
  private reportRecovery() {
    if(this.closed)return;
    const failed=[...this.streamReady].filter(([lane,ready])=>!ready && this.targets.has(lane)).map(([lane])=>this.targets.get(lane)!.kind);
    this.callbacks.recovery?.(failed.some(k=>['room','table','game'].includes(k))?'snapshot'
      :failed.some(k=>k.endsWith('_chat')) || this.discoveryIssues.includes('chat')?'chat':failed.length || this.discoveryIssues.length?'social':null);
  }
  async select(selection: Selection | null) {
    if (selection && (!selection.room || (selection.chat?.length ?? 0) > 3)) throw Error('Invalid selection.');
    if(this.socket && JSON.stringify(selection)===JSON.stringify(this.selection))return;
    const previous = this.selection;
    this.selection = copy(selection); this.selectionGeneration++;
    this.projection = null; this.snapshotRead = null; this.streamReady.clear();this.reportRecovery();
    if(!this.socket) { await this.reconnect(); return; }
    await this.session.reconfigure(lane => {
      const target = this.targets.get(lane);
      if(!target)return false;
      if(!target.room_id)return true; // Account/lobby/social streams survive navigation.
      if(target.room_id !== selection?.room)return false;
      if(target.kind === 'room' || target.kind === 'room_chat')return previous?.room === selection.room;
      return previous?.table===selection.table && target.table_id===selection.table
        && (['table','game'].includes(target.kind) || selection.chat?.includes(target.kind as 'table_chat'|'game_chat')===true);
    });

  }
  async wake(): Promise<void> {
    if(this.closed)return;
    if(!this.socket){await this.reconnect();return;}
    // Start health verification immediately, before timers delayed by suspension.
    const probe = this.socket.checkHealth?.() ?? Promise.resolve();
    await Promise.all([probe, this.session.refresh(), this.selection ? this.readSelectedProjection(new AbortController().signal,false) : Promise.resolve()]);
  }
  reconnect(): Promise<void> {
    if (this.closed) return Promise.reject(Error('Root session closed.'));
    if(this.connecting)return this.connecting;
    if(this.socket)return this.session.refresh();
    const work = this.connectSocket().finally(()=>{if(this.connecting===work)this.connecting=null;});
    this.connecting=work;return work;
  }
  private async connectSocket(): Promise<void> {
    clearTimeout(this.retry);
    const generation = ++this.generation;
    this.session.disconnect(); this.targets.clear(); this.snapshotRead = null;
    const failed = (detail: SocketDisconnect = {cause:'error'}) => {
      if (this.closed || generation !== this.generation) return;
      this.connectionDiagnostics.push({...detail,at:Date.now()});
      if(this.connectionDiagnostics.length>20)this.connectionDiagnostics.shift();
      this.generation++; this.callbacks.health?.(false);
      this.session.disconnect(); this.socket?.close(); this.socket = null;
      this.callbacks.error(null,new Error(`Delivery connection interrupted (${detail.cause}${detail.code ? ` ${detail.code}` : ''}).`),'connection');
      this.retry = setTimeout(() => { void this.reconnect().catch(e=>this.callbacks.error(null,e,'connection')); },Math.min(1000*2**this.attempts++,8000));
    };
    try {
      const socket = this.socketFactory(this.base.replace(/^http/,'ws')+'/delivery',this.token,this.owner.clientId,failed,()=>{
        if(this.closed || generation!==this.generation)return;
        this.attempts=0;this.callbacks.health?.(true);
      });
      if (this.closed || generation !== this.generation) { socket.close(); return; }
      this.socket = socket;
      await this.session.connect();
    } catch (error) { failed(); throw error; }
  }
  private readSelectedProjection(signal: AbortSignal, invalidate = true): Promise<Projection> {
    const selected = copy(this.selection), generation = this.selectionGeneration;
    if(!selected)return Promise.reject(Error('No selected hosted view.'));
    if(!this.snapshotRead)this.snapshotRead=new CoalescedRead(async signal=>{
      const value=await this.reads.room<Projection>(selected.room,selected.table,signal);
      if(signal.aborted || generation!==this.selectionGeneration)throw Error('Obsolete snapshot read.');
      this.validateProjection(value,selected);
      const old=this.projection?.snapshot,next=value.snapshot;
      if(!old || !next || (next.table_revision>=old.table_revision && (next.durable_game_id!==old.durable_game_id
          || !next.game || !old.game || next.game.revision>=old.game.revision))) {
        if(next?.match_id)this.snapshotClock.success(selected.room,next.match_id);
        this.install('snapshot-read',{kind:'snapshot',value},false);
      }
      return value;
    });
    return this.snapshotRead.load(signal,invalidate);
  }
  async readGameView<T>(room: string, match: string | null, signal: AbortSignal, invalidate = false): Promise<T> {
    const selected=this.selection;
    if(match && selected?.room===room && selected.table && this.projection?.snapshot?.match_id===match) {
      const projection=await this.readSelectedProjection(signal,invalidate);
      if(projection.snapshot?.match_id===match)return copy(projection.snapshot) as T;
      // Preserve the original match-addressed endpoint's 404 semantics after a rematch.
    }
    const key=JSON.stringify([room,match]);
    let reader=this.gameReads.get(key);
    if(!reader){
      reader=new CoalescedRead(async signal=>{
        const value=await this.reads.gameView<GameReadView>(room,match,signal);
        if(this.closed || signal.aborted)throw Error('Obsolete game read.');
        if(value?.room_id===room && value.match_id && value.game && Number.isSafeInteger(value.game.revision) && value.game.revision>=0) {
          const old=this.projection?.snapshot;
          if(!old || old.match_id!==value.match_id || value.game.revision>=(old.game?.revision??0))
            this.snapshotClock.success(room,value.match_id);
          if(this.selection?.room===room && this.selection.table && value.table_id===this.selection.table)
            this.install('snapshot-read',{kind:'snapshot',value:{room_id:room,snapshot:value as Projection['snapshot']}},false);
        }
        return value;
      });
      this.gameReads.set(key,reader);
      if(this.gameReads.size>128)this.gameReads.delete(this.gameReads.keys().next().value!);
    }
    return copy(await reader.load(signal,invalidate)) as T;
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
    this.closed = true; this.generation++;this.selectionGeneration++;clearTimeout(this.retry);
    this.session.close(); this.socket?.close(); this.socket = null;this.targets.clear();this.projection = null;this.observers.clear();this.activityObservers.clear();this.gameReads.clear();this.streamReady.clear();
  }
}

export function distributedRoot(acquire: AcquireJournal) { return new OwnedSession<DistributedRootRuntime>(acquire); }
