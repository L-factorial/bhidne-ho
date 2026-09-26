import * as SecureStore from 'expo-secure-store';
import { acquireNativeJournal } from './nativeJournalOwner.ts';

// Synchronous replacement: never acknowledge a queued AsyncStorage write as saved.
const key = (value: string) => 'bhidne.journal.' + Array.from(value).map(c => c.codePointAt(0)!.toString(16)).join('_');
export function acquireJournal(account: string, signal: AbortSignal) {
  return acquireNativeJournal({
    read: name => SecureStore.getItem(key(name)),
    write: (name, value) => SecureStore.setItem(key(name), value, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    }),
  }, account, signal);
}
