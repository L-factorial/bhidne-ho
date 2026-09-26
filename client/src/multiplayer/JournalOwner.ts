import { CommandJournal } from './CommandJournal.ts';
import type { JournalStorage } from './CommandJournal.ts';
export type JournalOwner = { clientId: string; journal: CommandJournal; close(): void };
export type AcquireJournal = (account: string, signal: AbortSignal) => Promise<JournalOwner>;
export function ownerKey(account: string) {
  if (!account.trim() || account.length > 128) throw new Error('Invalid account identity.');
  return `distributed-owner:${JSON.stringify(account)}`;
}
// Invoke only while holding the platform's exclusive account lock.
export function createJournalOwner(store: JournalStorage, account: string, release: () => void): JournalOwner {
  let active = true;
  const guarded: JournalStorage = {
    read: key => { if (!active) throw new Error('Journal owner closed.'); return store.read(key); },
    write: (key, value) => { if (!active) throw new Error('Journal owner closed.'); store.write(key, value); },
  };
  try {
    const key = ownerKey(account) + ':device';
    let clientId = guarded.read(key);
    if (clientId === null) {
      clientId = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}-${Math.random()}`;
      guarded.write(key, clientId);
      if (guarded.read(key) !== clientId) throw new Error('Device identity write failed.');
    }
    if (!clientId.trim() || clientId.length > 128) throw new Error('Invalid stored device identity.');
    const journal = new CommandJournal(guarded, account, clientId);
    return { clientId, journal, close() {
      if (!active) return;
      active = false; journal.close(); release();
    } };
  } catch (e) { active = false; release(); throw e; }
}

// One controller per authenticated app root. Screen lifetimes do not own journals.
export class OwnedSession<S extends { close(): void }> {
  private generation = 0;
  private pending: AbortController | null = null;
  private owner: JournalOwner | null = null;
  private session: S | null = null;
  private acquire: AcquireJournal;
  constructor(acquire: AcquireJournal) { this.acquire = acquire; }
  async select(account: string, create: (owner: JournalOwner) => S): Promise<S | null> {
    this.close();
    const generation = this.generation, pending = new AbortController(); this.pending = pending;
    let owner: JournalOwner;
    try { owner = await this.acquire(account, pending.signal); }
    catch (error) { if (pending.signal.aborted || generation !== this.generation) return null; throw error; }
    if (pending.signal.aborted || generation !== this.generation) { owner.close(); return null; }
    try {
      const session = create(owner);
      if (pending.signal.aborted || generation !== this.generation) {
        try { session.close(); } finally { owner.close(); }
        return null;
      }
      this.owner = owner; this.session = session; return session;
    } catch (error) { owner.close(); throw error; }
  }
  close() {
    this.generation++; const pending = this.pending; this.pending = null;
    const session = this.session, owner = this.owner; this.session = null; this.owner = null;
    try { session?.close(); } finally {
      // Abort listeners may release the platform lock: stop session work first.
      try { pending?.abort(); } finally { owner?.close(); }
    }
  }
}
