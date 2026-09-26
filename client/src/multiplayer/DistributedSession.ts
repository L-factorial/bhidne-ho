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
  lane: string; controller: AbortController; queue: unknown[]; running: boolean;
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
  private report: (lane: string | null, error: unknown) => void;
  private transient?: (events: DeliveryEvent[]) => void;
  private entries = new Map<string, Entry<T>>();
  private commands = new Map<string, DurableCommandClient>();
  private connection: AbortController | null = null;
  private refreshing: AbortController | null = null;
  private timer?: ReturnType<typeof setTimeout>;
  private closed = false;
  private jobs: Entry<T>[] = [];
  private workers = 0;
  private limits: { streams: number; pages: number; pageBytes: number; workers: number; timeoutMs: number; refreshMs: number };

  constructor(clientId: string, transport: SessionTransport<T>, callbacks: {
    install(lane: string, value: T): void; remove(lane: string): void;
    error(lane: string | null, error: unknown): void;
    transient?(events: DeliveryEvent[]): void;
  }, limits: Partial<DistributedSession<T>['limits']> = {}, journal?: CommandJournal) {
    this.limits = { streams: 128, pages: 8, pageBytes: 262144, workers: 4, timeoutMs: 10000, refreshMs: 5000, ...limits };
    const l = this.limits;
    if (!clientId.trim() || clientId.length > 128 || !positive(l.streams, 2048) || !positive(l.pages, 32)
        || !positive(l.pageBytes, 1048576) || !positive(l.workers, 32)
        || !positive(l.timeoutMs, 60000) || !positive(l.refreshMs, 300000)) throw new Error('Invalid session bounds.');
    this.clientId = clientId; this.transport = transport;
    this.install = callbacks.install; this.remove = callbacks.remove; this.report = callbacks.error;
    this.transient = callbacks.transient;
    journal?.assertDevice(clientId);
    this.journal = journal;
    // Restore all slots, including intentions from screens not currently mounted.
    for (const slot of journal?.slots ?? []) this.command(slot);
  }
  private error(lane: string | null, error: unknown) {
    try { this.report(lane, error); } catch { /* Error reporting cannot strand cleanup. */ }
  }
  command(slot: string): DurableCommandClient {
    this.journal?.check();
    if (this.closed || !slot.trim()) throw new Error('Invalid command session.');
    let command = this.commands.get(slot);
    if (!command) {
      if (this.commands.size >= 32) throw new Error('Command slot bound exceeded.');
      command = new DurableCommandClient(this.transport.commands, { timeoutMs: this.limits.timeoutMs, persistence: this.journal?.bind(slot) });
      this.commands.set(slot, command);
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
    try {
      try { await this.refresh(); } catch (e) { if (!connection.signal.aborted) this.error(null, e); }
      // Receipt recovery must continue even if discovery or membership is unavailable.
      // Sequential bounded command recovery; slots remain owned even offscreen.
      for (const c of this.commands.values()) {
        if (connection.signal.aborted) break;
        if (c.pending) try { await c.reconcile(connection.signal); } catch (e) { this.error(null, e); }
      }
    } catch (e) { if (!connection.signal.aborted) this.error(null, e); }
    finally {
      if (this.connection === connection && !connection.signal.aborted) {
        this.timer = setTimeout(() => { void this.tick(connection); }, this.limits.refreshMs);
      }
    }
  }
  async refresh(): Promise<void> {
    const connection = this.connection;
    if (!connection || connection.signal.aborted) throw new Error('Session is disconnected.');
    if (this.refreshing === connection) return;
    this.refreshing = connection;
    try {
      const lanes = await discoverDeliveryStreams((after, signal) => this.transport.discover(after, signal),
        connection.signal, this.limits.streams, this.limits.timeoutMs);
      if (this.connection !== connection || connection.signal.aborted) return;
      const allowed = new Set(lanes);
      for (const entry of this.entries.values()) if (!allowed.has(entry.lane)) this.drop(entry);
      for (const lane of lanes) if (!this.entries.has(lane)) {
        const entry: Entry<T> = { lane, controller: new AbortController(), queue: [], running: false };
        this.entries.set(lane, entry); this.schedule(entry);
      }
    } finally { if (this.refreshing === connection) this.refreshing = null; }
  }
  private current(e: Entry<T>) { return this.entries.get(e.lane) === e; }
  private drop(e: Entry<T>) {
    if (!this.current(e)) return;
    this.entries.delete(e.lane); e.controller.abort(); e.delivery?.close(); e.queue = [];
    this.jobs = this.jobs.filter(job => job !== e);
    try { e.subscription?.close(); } catch (error) { this.error(e.lane, error); }
    try { this.remove(e.lane); } catch (error) { this.error(e.lane, error); }
  }
  private fail(e: Entry<T>, error: unknown) { if (this.current(e)) { this.drop(e); this.error(e.lane, error); } }
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
      }, this.limits.timeoutMs);
      await e.delivery.recover(subscription.cursor);
    } else if (e.queue.length) await e.delivery.receive(e.queue.shift());
  }
  disconnect() {
    clearTimeout(this.timer); this.connection?.abort(); this.connection = null;
    for (const e of this.entries.values()) this.drop(e);
  }
  close() {
    this.closed = true; this.disconnect();
    for (const c of this.commands.values()) c.close();
    this.commands.clear();
    this.journal?.close();
  }
}
