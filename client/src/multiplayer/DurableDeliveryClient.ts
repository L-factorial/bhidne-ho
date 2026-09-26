// Explicit adapters: mounted sockets must bind actor, device and subscription handle.
export type DeliveryEvent = {
  event_id: string; lane_id: string; sequence: number; event_type: string;
  event_version: number; payload: unknown;
};
export type DeliveryPage = {
  type: 'DELIVERY_PAGE'; lane_id: string; after_sequence: number;
  scanned_sequence: number; has_more: boolean; events: DeliveryEvent[];
};
const position = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) >= 0;
const identity = (s: unknown): s is string => typeof s === 'string' && s.length > 0;

export async function boundedDelivery<T>(controller: AbortController, timeout: number, work: () => Promise<T>): Promise<T> {
  let abort = () => {};
  const canceled = new Promise<never>((_, reject) => {
    abort = () => reject(new Error('Delivery operation aborted or timed out.'));
    controller.signal.addEventListener('abort', abort, { once: true });
  });
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    if (controller.signal.aborted) throw new Error('Delivery operation aborted.');
    return await Promise.race([Promise.resolve().then(() => {
      if (controller.signal.aborted) throw new Error('Delivery operation aborted.');
      return work();
    }), canceled]);
  } finally {
    clearTimeout(timer); controller.signal.removeEventListener('abort', abort);
  }
}

function validate(value: unknown, lane: string): DeliveryPage {
  if (!value || typeof value !== 'object') throw new Error('Invalid delivery page.');
  const p = value as DeliveryPage;
  if (p.type !== 'DELIVERY_PAGE' || p.lane_id !== lane || !position(p.after_sequence)
      || !position(p.scanned_sequence) || p.scanned_sequence < p.after_sequence
      || typeof p.has_more !== 'boolean' || !Array.isArray(p.events) || p.events.length > 1000) {
    throw new Error('Invalid delivery page boundary.');
  }
  let last = p.after_sequence;
  const ids = new Set<string>();
  for (const e of p.events) {
    if (!e || !identity(e.event_id) || ids.has(e.event_id) || e.lane_id !== lane
        || !position(e.sequence) || e.sequence <= last || e.sequence > p.scanned_sequence
        || !identity(e.event_type) || e.event_version !== 1 || !Object.hasOwn(e, 'payload')) {
      throw new Error('Invalid or unsupported delivery event.');
    }
    ids.add(e.event_id); last = e.sequence;
  }
  return p;
}

export type DeliveryView<T> = {
  // Read authorized current snapshot/history. Never mutate UI in this async callback.
  // Merge paginated history by stable message IDs in the returned view, not by append.
  load(signal: AbortSignal): Promise<T>;
  // Synchronous replacement of this lane's view. No irreversible event side effects.
  install(value: T): void;
  acknowledge(scannedSequence: number, signal: AbortSignal): Promise<void>;
  // Optional expiring presentation only; never apply game state or payments here.
  transient?(events: DeliveryEvent[]): void;
};

// One instance per authenticated device/lane/subscription incarnation. Different
// lanes can progress independently; callbacks for the same lane must be serialized.
export class DurableDeliveryClient<T> {
  private lane: string;
  private view: DeliveryView<T>;
  private timeout: number;
  private cursor: number | null = null;
  private active: AbortController | null = null;
  private closed = false;
  constructor(lane: string, view: DeliveryView<T>, timeoutMs = 10000) {
    if (!identity(lane) || !Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('Invalid delivery configuration.');
    this.lane = lane; this.view = view; this.timeout = timeoutMs;
  }
  get appliedSequence() { return this.cursor; }

  private async run<R>(work: (signal: AbortSignal) => Promise<R>): Promise<R> {
    if (this.closed) throw new Error('Delivery subscription is closed.');
    if (this.active) throw new Error('Serialize delivery operations.');
    const controller = new AbortController(); this.active = controller;
    try { return await boundedDelivery(controller, this.timeout, () => work(controller.signal)); }
    finally { this.active = null; }
  }
  private check(signal: AbortSignal) {
    if (this.closed || signal.aborted) throw new Error('Obsolete delivery operation.');
  }

  // cursor must come from this authenticated subscription's server-side device
  // cursor, NOT a Redis hint, emitted high-water mark or another device's cursor.
  async recover(cursor: number): Promise<void> {
    if (!position(cursor) || this.cursor !== null) throw new Error('Invalid initial delivery cursor.');
    return this.run(async signal => {
      const value = await this.view.load(signal);
      this.check(signal); this.view.install(value); this.check(signal);
      this.cursor = cursor; // No ACK: a snapshot is not an outbox retention boundary.
    });
  }

  async receive(value: unknown): Promise<void> {
    // Detach transport-owned objects before asynchronous work.
    const page = validate(JSON.parse(JSON.stringify(value)), this.lane);
    return this.run(async signal => {
      if (this.cursor === null) throw new Error('Recover the view before delivery.');
      if (page.after_sequence > this.cursor) throw new Error('Delivery gap: resubscribe and reconcile.');
      if (page.scanned_sequence > this.cursor) {
        const transient = page.events.filter(e => e.sequence > this.cursor! && e.event_type === 'ROOM_POKE');
        // Events invalidate current state; never replay old engine deltas over a
        // newer snapshot. Hidden-only pages need no view refresh.
        if (page.events.some(e => e.sequence > this.cursor!)) {
          const state = await this.view.load(signal);
          this.check(signal); this.view.install(state); this.check(signal);
        }
        this.check(signal); this.cursor = page.scanned_sequence;
        if (transient.length) try { this.view.transient?.(transient); } catch { /* Presentation cannot alter durable ACK progress. */ }
      }
      this.check(signal);
      // ACK only this page's offered boundary, even if it is a duplicate of an
      // older page. A lost ACK replays without reapplying the view on this instance.
      await this.view.acknowledge(page.scanned_sequence, signal);
    });
  }
  close() { this.closed = true; this.active?.abort(); }
}

export type StreamCatalogPage = { items: { lane_id: string }[]; next_lane_id: string | null };
// Collect a complete bounded authorized catalog before replacing subscriptions.
// SocialHistory.streams supplies this shape; hosted scopes need their C3 adapter.
export async function discoverDeliveryStreams(
  fetchPage: (after: string | null, signal: AbortSignal) => Promise<StreamCatalogPage>,
  signal: AbortSignal, maxStreams = 128, timeoutMs = 10000,
): Promise<string[]> {
  if (!Number.isSafeInteger(maxStreams) || maxStreams < 1 || maxStreams > 2048
      || !Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('Invalid discovery bound.');
  const controller = new AbortController(), abort = () => controller.abort();
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) abort();
  try {
    return await boundedDelivery(controller, timeoutMs, async () => {
      const lanes = new Set<string>(), cursors = new Set<string>();
      let after: string | null = null;
      for (let pageNumber = 0; pageNumber <= maxStreams; pageNumber++) {
        const page = await fetchPage(after, controller.signal);
        if (controller.signal.aborted) throw new Error('Obsolete discovery.');
        if (!page || !Array.isArray(page.items) || page.items.length > maxStreams
            || (page.next_lane_id !== null && !identity(page.next_lane_id))) throw new Error('Invalid stream catalog.');
        for (const item of page.items) {
          if (!item || !identity(item.lane_id) || lanes.has(item.lane_id)) throw new Error('Duplicate or invalid catalog stream.');
          lanes.add(item.lane_id);
          if (lanes.size > maxStreams) throw new Error('Stream catalog exceeds subscription bound.');
        }
        if (page.next_lane_id === null) return [...lanes];
        if (!page.items.length || cursors.has(page.next_lane_id)
            || page.next_lane_id !== page.items.at(-1)!.lane_id) throw new Error('Invalid stream catalog cursor.');
        cursors.add(page.next_lane_id); after = page.next_lane_id;
      }
      throw new Error('Stream catalog exceeds page bound.');
    });
  } finally { signal.removeEventListener('abort', abort); }
}
