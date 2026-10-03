import type { CommandJournal } from './CommandJournal.ts';
import { DurableCommandClient } from './DurableCommandClient.ts';
import type { DurableCommandTransport } from './DurableCommandClient.ts';
import { boundedDelivery, discoverDeliveryStreams, DurableDeliveryClient } from './DurableDeliveryClient.ts';
import type { StreamCatalogPage } from './DurableDeliveryClient.ts';
import type { DeliveryEvent } from './DurableDeliveryClient.ts';

export type Subscription = {
  cursor: number;
  acknowledge(sequence: number, signal: AbortSignal): Promise<void>;
  close(): void;
};
export type SessionTransport<T> = {
  commands: DurableCommandTransport;
  discover(after: string | null, signal: AbortSignal): Promise<StreamCatalogPage>;
  open(lane: string, clientId: string, page: (value: unknown) => void,
    revoked: () => void, signal: AbortSignal): Promise<Subscription>;
  load(lane: string, signal: AbortSignal): Promise<T>;
};
type Entry<T> = {
  lane: string; controller: AbortController; queue: unknown[]; running: boolean; ready: boolean;
  subscription?: Subscription; delivery?: DurableDeliveryClient<T>;
};
const positive = (v: number, max: number) => Number.isSafeInteger(v) && v > 0 && v <= max;

// Storage must be scoped to one device/tab and writes must be durable before use.
// Web callers use sessionStorage (not shared localStorage); native callers hydrate
// an installation store before constructing the session. Never store credentials here.
export function deliveryClientId(store: Pick<Storage, 'getItem' | 'setItem'>, scope: string,
  create = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}-${Math.random()}`): string {
  if (!scope.trim()) throw new Error('Device scope is required.');
  const key = `distributed-client:${scope}`;
  const value = store.getItem(key) ?? create();
  if (!value.trim() || value.length > 128) throw new Error('Invalid device identity.');
  store.setItem(key, value); return value;
}

// Own above screen components. Reconnect preserves commands; logout closes forever.
export class DistributedSession<T> {
  private transport: SessionTransport<T>;
  private journal?: CommandJournal;
  private clientId: string;
  private install: (lane: string, value: T) => void;
  private remove: (lane: string) => void;
  private report: (lane: string | null, error: unknown, source?: 'command' | 'delivery') => void;
  private transient?: (events: DeliveryEvent[]) => void;
  private entries = new Map<string, Entry<T>>();
  private commands = new Map<string, DurableCommandClient>();
  private connection: AbortController | null = null;
  private refreshing: AbortController | null = null;
  private refreshWork: Promise<void> | null = null;
  private ticking: AbortController | null = null;
  private timer?: ReturnType<typeof setTimeout>;
  private closed = false;
  private discovered = false;
  private discoveryRetry = false;
  private lastDiscovery = 0;
  private healthy = false;
  private health?: (ready: boolean) => void;
  private streamHealth?: (lane: string, ready: boolean) => void;
  private jobs: Entry<T>[] = [];
  private workers = 0;
  private limits: { streams: number; pages: number; pageBytes: number; workers: number; timeoutMs: number; refreshMs: number };

  constructor(clientId: string, transport: SessionTransport<T>, callbacks: {
    install(lane: string, value: T): void; remove(lane: string): void;
    error(lane: string | null, error: unknown, source?: 'command' | 'delivery'): void;
    transient?(events: DeliveryEvent[]): void;
    health?(ready: boolean): void;
    streamHealth?(lane: string, ready: boolean): void;
  }, limits: Partial<DistributedSession<T>['limits']> = {}, journal?: CommandJournal) {
    this.limits = { streams: 128, pages: 8, pageBytes: 262144, workers: 4, timeoutMs: 10000, refreshMs: 5000, ...limits };
    const l = this.limits;
    if (!clientId.trim() || clientId.length > 128 || !positive(l.streams, 2048) || !positive(l.pages, 32)
        || !positive(l.pageBytes, 1048576) || !positive(l.workers, 32)
        || !positive(l.timeoutMs, 60000) || !positive(l.refreshMs, 300000)) throw new Error('Invalid session bounds.');
    this.clientId = clientId; this.transport = transport;
    this.install = callbacks.install; this.remove = callbacks.remove; this.report = callbacks.error;
    this.transient = callbacks.transient;
    this.health = callbacks.health; this.streamHealth = callbacks.streamHealth;
    journal?.assertDevice(clientId);
    this.journal = journal;
    // Restore all slots, including intentions from screens not currently mounted.
    for (const slot of journal?.slots ?? []) this.command(slot);
  }
  private error(lane: string | null, error: unknown, source: 'command' | 'delivery' = 'delivery') {
    try { this.report(lane, error, source); } catch { /* Error reporting cannot strand cleanup. */ }
  }
  command(slot: string): DurableCommandClient {
    this.journal?.check();
    if (this.closed || !slot.trim()) throw new Error('Invalid command session.');
    let command = this.commands.get(slot);
    if (!command) {
      if (this.commands.size >= 32) throw new Error('Command slot bound exceeded.');
      command = new DurableCommandClient(this.transport.commands, { timeoutMs: this.limits.timeoutMs, persistence: this.journal?.bind(slot) });
      this.commands.set(slot, command);
      command.observe(()=>{
        const connection=this.connection;
        if(command!.pending && connection && !connection.signal.aborted && this.ticking!==connection){
          clearTimeout(this.timer);this.timer=setTimeout(()=>void this.tick(connection),Math.min(1000,this.limits.refreshMs));
        }
      });
    }
    return command;
  }
  releaseCommand(slot: string): boolean {
    const c = this.commands.get(slot);
    if (!c || c.pending) return false;
    this.journal?.release(slot);
    c.close(); return this.commands.delete(slot);
  }
  async connect(): Promise<void> {
    if (this.closed) throw new Error('Session is closed.');
    this.disconnect();
    const connection = new AbortController(); this.connection = connection;
    await this.tick(connection);
  }
  private async tick(connection: AbortController) {
    if (this.connection !== connection || connection.signal.aborted || this.ticking === connection) return;
    this.ticking = connection;
    try {
      try { if(!this.healthy || this.discoveryRetry || Date.now()-this.lastDiscovery>=this.limits.refreshMs)await this.refresh(); } catch (e) { if (!connection.signal.aborted) this.error(null, e); }
      // Receipt recovery must continue even if discovery or membership is unavailable.
      // Sequential bounded command recovery; slots remain owned even offscreen.
      for (const c of this.commands.values()) {
        if (connection.signal.aborted) break;
        if (c.pending && !c.reconciling) try { await c.reconcile(connection.signal); } catch (e) { if (!connection.signal.aborted) this.error(null, e, 'command'); }
      }
    } catch (e) { if (!connection.signal.aborted) this.error(null, e); }
    finally {
      if (this.ticking === connection) this.ticking = null;
      if (this.connection === connection && !connection.signal.aborted) {
        clearTimeout(this.timer);
        this.timer = setTimeout(() => { void this.tick(connection); }, this.healthy && !this.discoveryRetry && ![...this.commands.values()].some(c=>c.pending) ? Math.max(1,this.limits.refreshMs-(Date.now()-this.lastDiscovery)) : Math.min(1000, this.limits.refreshMs));
      }
    }
  }
  refresh(): Promise<void> {
    if (this.refreshWork) return this.refreshWork;
    const connection = this.connection;
    if (!connection || connection.signal.aborted) return Promise.reject(Error('Session is disconnected.'));
    const controller = new AbortController();
    const cancel = () => controller.abort();
    connection.signal.addEventListener('abort', cancel, {once:true});
    this.refreshing = controller;
    const work = this.discover(connection, controller).finally(() => {
      connection.signal.removeEventListener('abort', cancel);
      if (this.refreshing === controller) { this.refreshing = null; this.refreshWork = null; }
    });
    this.refreshWork = work;
    return work;
  }
  private async discover(connection: AbortController, controller: AbortController): Promise<void> {
    if (!connection || connection.signal.aborted) throw new Error('Session is disconnected.');
    try {
      this.discoveryRetry = false;
      const lanes = await discoverDeliveryStreams((after, signal) => this.transport.discover(after, signal),
        controller.signal, this.limits.streams, this.limits.timeoutMs);
      if (this.connection !== connection || connection.signal.aborted || controller.signal.aborted) return;
      const allowed = new Set(lanes);
      for (const entry of this.entries.values()) if (!allowed.has(entry.lane)) this.drop(entry);
      for (const lane of lanes) if (!this.entries.has(lane)) {
        const entry: Entry<T> = { lane, controller: new AbortController(), queue: [], running: false, ready: false };
        this.entries.set(lane, entry); this.streamHealth?.(lane, false); this.schedule(entry);
      }
      this.discovered = true; this.lastDiscovery=Date.now(); this.updateHealth();
    } catch (error) {
      if (this.connection === connection && !connection.signal.aborted && !controller.signal.aborted) {
        this.discovered = false; this.updateHealth();
      }
      if (!controller.signal.aborted) throw error;
    }
  }
  private updateHealth() {
    const ready = !!this.connection && !this.connection.signal.aborted && this.discovered
      && [...this.entries.values()].every(entry => entry.ready);
    if (ready === this.healthy) return;
    this.healthy = ready;
    this.health?.(ready);
  }
  private current(e: Entry<T>) { return this.entries.get(e.lane) === e; }
  private drop(e: Entry<T>) {
    if (!this.current(e)) return;
    this.entries.delete(e.lane); this.streamHealth?.(e.lane, false); e.controller.abort(); e.delivery?.close(); e.queue = [];
    this.jobs = this.jobs.filter(job => job !== e);
    try { e.subscription?.close(); } catch (error) { this.error(e.lane, error); }
    try { this.remove(e.lane); } catch (error) { this.error(e.lane, error); }
  }
  private fail(e: Entry<T>, error: unknown) {
    if (this.current(e)) {
      this.discovered = false; this.drop(e); this.updateHealth(); this.error(e.lane, error);
      // Recover failed lanes promptly, without replacing healthy subscriptions.
      clearTimeout(this.timer);
      const connection = this.connection;
      if (connection && !connection.signal.aborted && this.ticking !== connection)
        this.timer = setTimeout(() => { void this.tick(connection); }, Math.min(1000, this.limits.refreshMs));
    }
  }
  private enqueue(e: Entry<T>, value: unknown) {
    if (!this.current(e)) return;
    try {
      const encoded = JSON.stringify(value);
      if (!encoded || encoded.length * 2 > this.limits.pageBytes || e.queue.length >= this.limits.pages) {
        throw new Error('Delivery buffer overflow; resubscription required.');
      }
      e.queue.push(JSON.parse(encoded)); this.schedule(e);
    } catch (error) { this.fail(e, error); }
  }
  private schedule(e: Entry<T>) {
    if (!this.current(e) || e.running || this.jobs.includes(e)) return;
    this.jobs.push(e); this.pump();
  }
  private pump() {
    while (this.workers < this.limits.workers && this.jobs.length) {
      const e = this.jobs.shift()!;
      if (!this.current(e)) continue;
      e.running = true; this.workers++;
      void this.step(e).catch(error => this.fail(e, error)).finally(() => {
        e.running = false; this.workers--;
        if (this.current(e) && e.queue.length) this.schedule(e);
        this.pump();
      });
    }
  }
  private async step(e: Entry<T>) {
    if (!e.delivery) {
      const subscription = await boundedDelivery(e.controller, this.limits.timeoutMs, async () => {
        const s = await this.transport.open(e.lane, this.clientId, p => this.enqueue(e, p),
          () => this.fail(e, new Error('Subscription closed or revoked.')), e.controller.signal);
        if (!this.current(e) || e.controller.signal.aborted) { s.close(); throw new Error('Obsolete subscription.'); }
        return s;
      });
      if (!this.current(e) || e.controller.signal.aborted) { subscription.close(); return; }
      e.subscription = subscription;
      e.delivery = new DurableDeliveryClient(e.lane, {
        load: signal => this.transport.load(e.lane, signal),
        install: value => { if (this.current(e)) this.install(e.lane, value); },
        acknowledge: (n, signal) => subscription.acknowledge(n, signal),
        transient: events => { if(this.current(e)) this.transient?.(events); },
        committed: events => {
          if(!this.current(e))return;
          for(const event of events)if(['ACTION_ACK','TABLE_COMMAND_ACK','ROOM_COMMAND_ACK','TABLE_CREATION_ACK','CHAT_COMMAND_ACK','SOCIAL_COMMAND_ACK'].includes(event.event_type)) {
            for(const command of this.commands.values())command.acceptCommitted(e.lane,event.payload as import('./DurableCommandClient.ts').CommandOutcome);
          }
        },
      }, this.limits.timeoutMs);
      await e.delivery.recover(subscription.cursor);
      if (this.current(e) && !e.controller.signal.aborted) { e.ready = true; this.streamHealth?.(e.lane, true); this.updateHealth(); }
    } else if (e.queue.length) await e.delivery.receive(e.queue.shift());
  }
  retryDiscovery(delay = 1000) {
    this.discoveryRetry = true;
    const connection=this.connection;
    if(connection && !connection.signal.aborted && this.ticking!==connection){
      clearTimeout(this.timer);this.timer=setTimeout(()=>void this.tick(connection),Math.min(delay,this.limits.refreshMs));
    }
  }
  // Replace selected scopes without replacing the session, socket, global lanes,
  // or any pending command. Abort obsolete discovery before applying its catalog.
  async reconfigure(keep: (lane: string) => boolean): Promise<void> {
    this.refreshing?.abort(); this.refreshing = null; this.refreshWork = null;
    for (const entry of this.entries.values()) if (!keep(entry.lane)) this.drop(entry);
    this.discovered = false; this.updateHealth();
    try { await this.refresh(); } catch (error) { this.error(null, error); }
  }
  disconnect() {
    this.refreshing?.abort(); this.refreshing = null; this.refreshWork = null;
    clearTimeout(this.timer); this.connection?.abort(); this.connection = null;
    for (const e of this.entries.values()) this.drop(e);
    this.discovered = false; this.updateHealth();
  }
  close() {
    this.closed = true; this.disconnect();
    for (const c of this.commands.values()) c.close();
    this.commands.clear();
    this.journal?.close();
  }
}
