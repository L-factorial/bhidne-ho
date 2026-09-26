import { createJournalOwner, ownerKey } from './JournalOwner.ts';
import type { JournalOwner } from './JournalOwner.ts';

// Explicit browser binding; no startup side effects. localStorage survives tab
// closure, while Web Locks prevent duplicated tabs sharing a writer/cursor.
export function acquireJournal(account: string, signal: AbortSignal,
  environment: { storage: Pick<Storage, 'getItem' | 'setItem'>; locks: Pick<LockManager, 'request'> } = {
    storage: globalThis.localStorage, locks: globalThis.navigator?.locks,
  }): Promise<JournalOwner> {
  const key = ownerKey(account);
  if (!environment.storage || !environment.locks) return Promise.reject(new Error('Persistent storage and Web Locks are required.'));
  if (signal.aborted) return Promise.reject(new Error('Journal acquisition aborted.'));
  return new Promise((resolve, reject) => {
    let owner: JournalOwner | undefined;
    const request = environment.locks.request(key, { mode: 'exclusive', ifAvailable: true }, async lock => {
      if (!lock) { reject(new Error('This account already has an active journal owner.')); return; }
      if (signal.aborted) { reject(new Error('Journal acquisition aborted.')); return; }
      let release!: () => void;
      const held = new Promise<void>(done => { release = done; });
      let abort = () => {};
      try {
        owner = createJournalOwner({ read: k => environment.storage.getItem(k), write: (k,v) => environment.storage.setItem(k,v) },
          account, () => { signal.removeEventListener('abort', abort); release(); });
        abort = () => owner?.close();
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) { owner.close(); reject(new Error('Journal acquisition aborted.')); return; }
        resolve(owner);
        await held;
      } catch (error) { release(); reject(error); }
    });
    void request.catch(error => { owner?.close(); reject(error); });
  });
}
