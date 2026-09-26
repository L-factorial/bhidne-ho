import { createJournalOwner, ownerKey } from './JournalOwner.ts';
import type { JournalStorage } from './CommandJournal.ts';
import type { JournalOwner } from './JournalOwner.ts';

// Native app currently has a single JS runtime. Keep the lock registry across
// module re-evaluation; extensions/multiple runtimes need a native OS lock first.
const registry = Symbol.for('bhidne.distributed-journal-owners');
const globalRegistry = globalThis as typeof globalThis & { [registry]?: Set<string> };
const held = globalRegistry[registry] ??= new Set<string>();
export async function acquireNativeJournal(store: JournalStorage, account: string, signal: AbortSignal): Promise<JournalOwner> {
  const key = ownerKey(account);
  if (signal.aborted) throw new Error('Journal acquisition aborted.');
  if (held.has(key)) throw new Error('This account already has an active journal owner.');
  held.add(key);
  let abort = () => {};
  const owner = createJournalOwner(store, account, () => {
    held.delete(key); signal.removeEventListener('abort', abort);
  });
  abort = () => owner.close();
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) { owner.close(); throw new Error('Journal acquisition aborted.'); }
  return owner;
}
