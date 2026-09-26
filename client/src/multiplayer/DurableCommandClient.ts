// Explicit distributed transport contract. Not wired to legacy game endpoints.
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type CommandTarget = { kind: string; [key: string]: string };
export type CommandBody = {
  command_id: string; command: string; payload: { [key: string]: Json };
  match_id?: string | null; expected_revision?: number | null;
};
export type CommandEnvelope = { target: CommandTarget; body: CommandBody };
export type StatusReference = { lane_id: string; command_id: string };
export type CommandOutcome = {
  command_id: string; status: 'accepted' | 'rejected'; revision?: number | null;
  detail?: string | null; table_id?: string | null; match_id?: string | null;
};
export type CommandReceipt = StatusReference & {
  sequence: number; status: 'pending' | 'accepted' | 'rejected';
  outcome: CommandOutcome | null; status_reference: StatusReference;
};
export type RoomCreationReceipt = { command_id: string; status: 'accepted'; room_id: string };
export type DurableReceipt = CommandReceipt | RoomCreationReceipt;
export type DurableCommandTransport = {
  // Implementations bind authentication to this instance, never to request JSON.
  submit(request: CommandEnvelope, signal: AbortSignal): Promise<unknown>;
  status(reference: StatusReference, signal: AbortSignal): Promise<unknown>;
};
let idSequence = 0;
function newCommandId() {
  // Non-secret deduplication key; authentication supplies the actor identity.
  return globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}-${(++idSequence).toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const nonempty = (value: unknown): value is string => typeof value === 'string' && value.length > 0;

function receipt(value: unknown, commandId: string, previous: CommandReceipt | null): CommandReceipt {
  if (!value || typeof value !== 'object') throw new Error('Invalid command receipt.');
  const r = value as CommandReceipt;
  if (r.command_id !== commandId || !nonempty(r.lane_id) || !Number.isSafeInteger(r.sequence) || r.sequence < 1
      || r.status_reference?.command_id !== commandId || r.status_reference?.lane_id !== r.lane_id
      || (previous && (previous.lane_id !== r.lane_id || previous.sequence !== r.sequence))) {
    throw new Error('Mismatched command receipt.');
  }
  if (r.status === 'pending') {
    if (r.outcome !== null) throw new Error('Pending command cannot have an outcome.');
  } else if (r.status === 'accepted' || r.status === 'rejected') {
    const o = r.outcome;
    if (!o || o.command_id !== commandId || o.status !== r.status
        || (o.revision != null && (!Number.isSafeInteger(o.revision) || o.revision < 0))
        || (o.detail != null && typeof o.detail !== 'string')
        || ((o.table_id != null || o.match_id != null)
          && (o.status !== 'accepted' || !nonempty(o.table_id) || !nonempty(o.match_id)))) {
      throw new Error('Invalid terminal command outcome.');
    }
  } else throw new Error('Unknown command status.');
  return copy(r);
}

function resultFor(request: CommandEnvelope, value: unknown, previous: DurableReceipt | null): DurableReceipt {
  if (request.target.kind === 'catalog') {
    const r = value as RoomCreationReceipt;
    if (request.body.command !== 'create-room' || !r || r.command_id !== request.body.command_id
        || r.status !== 'accepted' || typeof r.room_id !== 'string' || !/^[a-f0-9]{32}$/.test(r.room_id)
        || Object.keys(r).some(k => !['command_id','status','room_id'].includes(k))) {
      throw new Error('Invalid room creation receipt.');
    }
    return copy(r);
  }
  return receipt(value, request.body.command_id, previous as CommandReceipt | null);
}

export type CommandCheckpoint = { request: CommandEnvelope; receipt: DurableReceipt | null };
export type CommandPersistence = {
  load(): CommandCheckpoint | null;
  save(value: CommandCheckpoint): void;
  check(): void;
};
export function validateCommandCheckpoint(value: unknown): CommandCheckpoint {
  const s = value as CommandCheckpoint;
  const r = s?.request, b = r?.body, target = r?.target;
  if (!s || !r || !b || !target || !nonempty(target.kind)
      || Object.values(target).some(v => !nonempty(v))
      || !nonempty(b.command_id) || b.command_id.length > 128 || !nonempty(b.command)
      || !b.payload || typeof b.payload !== 'object' || Array.isArray(b.payload)
      || (b.match_id != null && !nonempty(b.match_id))
      || (b.expected_revision != null && (!Number.isSafeInteger(b.expected_revision) || b.expected_revision < 0))
      || !Object.hasOwn(s, 'receipt')) throw new Error('Invalid saved command.');
  return { request: copy(r), receipt: s.receipt === null ? null : resultFor(r, s.receipt, null) };
}

// One unresolved intention per instance. Retain it across socket reconnects and
// table switches; bind its lifetime/transport to one authenticated user session.
export class DurableCommandClient {
  private envelope: CommandEnvelope | null = null;
  private result: DurableReceipt | null = null;
  private active = false;
  private closed = false;
  private controller: AbortController | null = null;
  private transport: DurableCommandTransport;
  private timeoutMs: number;
  private newId: () => string;
  private persistence?: CommandPersistence;
  private storageFailed = false;
  private listeners = new Set<() => void>();
  observe(listener: () => void): () => void {
    if (this.closed || this.listeners.size >= 32) throw new Error('Command observer unavailable.');
    this.listeners.add(listener); return () => { this.listeners.delete(listener); };
  }
  private notify() { for (const listener of this.listeners) { try { listener(); } catch { /* UI must not affect committed state. */ } } }

  constructor(transport: DurableCommandTransport, options: { timeoutMs?: number; newId?: () => string; persistence?: CommandPersistence } = {}) {
    this.transport = transport;
    this.timeoutMs = options.timeoutMs ?? 10000;
    if (!Number.isFinite(this.timeoutMs) || this.timeoutMs <= 0) throw new Error('Invalid command timeout.');
    this.newId = options.newId ?? newCommandId;
    this.persistence = options.persistence;
    const saved = this.persistence?.load();
    if (saved) {
      const restored = validateCommandCheckpoint(saved);
      this.envelope = restored.request; this.result = restored.receipt;
    }
  }
  get pending() { return this.envelope !== null && (!this.result || this.result.status === 'pending'); }
  get request(): CommandEnvelope | null { return this.envelope && copy(this.envelope); }
  get latest(): DurableReceipt | null { return this.result && copy(this.result); }

  private checkStorage() {
    if (this.storageFailed) throw new Error('Command storage failed; reopen the journal before retrying.');
    this.persistence?.check();
  }
  private persist(request: CommandEnvelope, result: DurableReceipt | null) {
    try { this.persistence?.save({ request, receipt: result }); }
    catch (error) { this.storageFailed = true; throw error; }
  }

  begin(target: CommandTarget, body: Omit<CommandBody, 'command_id'>): boolean {
    if (this.closed) throw new Error('Command session is closed.');
    this.checkStorage();
    if (this.pending || this.active) return false;
    const command_id = this.newId();
    if (!nonempty(command_id)) throw new Error('Invalid command ID.');
    // Detach caller-owned payloads, including nested objects. The original target,
    // revision and match remain pinned; a fresh snapshot never rewrites them.
    const envelope = copy({ target, body: { ...body, command_id } });
    this.persist(envelope, null);
    this.envelope = envelope;
    this.result = null;
    this.notify();
    return true;
  }

  async reconcile(signal?: AbortSignal): Promise<DurableReceipt | null> {
    if (this.closed) throw new Error('Command session is closed.');
    this.checkStorage();
    if (this.active) throw new Error('Command reconciliation is already running.');
    if (!this.pending) return this.latest;
    if (signal?.aborted) throw new Error('Command reconciliation aborted.');
    this.active = true;
    const controller = new AbortController();
    this.controller = controller;
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(abort, this.timeoutMs);
    let onAbort: () => void = () => {};
    try {
      const canceled = new Promise<never>((_, reject) => {
        onAbort = () => reject(new Error('Command reconciliation aborted or timed out.'));
        controller.signal.addEventListener('abort', onAbort, { once: true });
      });
      // Before we know the lane, exact resubmission discovers the original receipt.
      // Once known, only status lookup is needed. Errors never imply rejection.
      const work = Promise.resolve().then(() => {
        if (controller.signal.aborted) throw new Error('Command reconciliation aborted.');
        return this.result && 'status_reference' in this.result
          ? this.transport.status(copy(this.result.status_reference), controller.signal)
          : this.transport.submit(copy(this.envelope!), controller.signal);
      });
      const value = await Promise.race([work, canceled]);
      if (controller.signal.aborted || this.closed) throw new Error('Command reconciliation aborted.');
      const result = resultFor(this.envelope!, value, this.result);
      this.persist(this.envelope!, result);
      this.result = result;
      this.notify();
      return this.latest;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      controller.signal.removeEventListener('abort', onAbort);
      this.controller = null;
      this.active = false;
    }
  }

  // Logout/account replacement: stop this session permanently. Never rebind its
  // transport to another actor. Closing does not cancel a server-side command.
  close() {
    this.closed = true;
    this.controller?.abort();
    this.envelope = null;
    this.result = null;
    this.notify(); this.listeners.clear();
  }
}
