// Loaders match the native history adapters; legacy history is kept separately.
export async function loadSequencedHistory<T extends { id: string; sequence: number }>(
  page: (after: number, signal: AbortSignal) => Promise<{ items: T[]; next_sequence: number | null }>,
  signal: AbortSignal, maximum = 1000,
): Promise<T[]> {
  if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > 10000) throw new Error('Invalid history bound.');
  const records = new Map<string, T>(); let after = 0;
  for (;;) {
    if (signal.aborted) throw new Error('History load aborted.');
    const result = await page(after, signal);
    if (signal.aborted) throw new Error('History load aborted.');
    if (!result || !Array.isArray(result.items) || result.items.length > maximum) throw new Error('Invalid history page.');
    let last = after;
    for (const item of result.items) {
      if (!item || typeof item.id !== 'string' || !item.id || records.has(item.id)
          || !Number.isSafeInteger(item.sequence) || item.sequence <= last) throw new Error('Invalid history order.');
      records.set(item.id, item); last = item.sequence;
      if (records.size > maximum) throw new Error('History exceeds materialized-view bound.');
    }
    if (result.next_sequence === null) return [...records.values()];
    if (!result.items.length || result.next_sequence !== last) throw new Error('Invalid history cursor.');
    after = last;
  }
}

// A selected durable match has one view owner. Never compare revisions across
// matches or retain old private cards while switching selection. Table revisions
// and engine revisions belong in separate instances.
export class RevisionView<T> {
  private selection: string | null = null;
  private revision = -1;
  private value: T | null = null;
  select(identity: string) {
    if (identity !== this.selection) { this.selection = identity; this.revision = -1; this.value = null; }
  }
  install(identity: string, revision: number, value: T): boolean {
    if (!Number.isSafeInteger(revision) || revision < 0) throw new Error('Invalid view revision.');
    if (identity !== this.selection || revision < this.revision) return false;
    this.value = JSON.parse(JSON.stringify(value)); this.revision = revision; return true;
  }
  get current(): T | null { return this.value === null ? null : JSON.parse(JSON.stringify(this.value)); }
  clear() { this.selection = null; this.revision = -1; this.value = null; }
}
