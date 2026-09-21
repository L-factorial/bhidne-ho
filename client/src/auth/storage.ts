// One storage adapter for both sessions and pending sign-in proofs. The native
// entrypoint installs SecureStore before any component reads a session.
type AuthStorage = { read(key: string): string | null; write(key: string, value: string | null): void };
function browserStorage() {
  if (!globalThis.sessionStorage) throw new Error('Browser session storage is unavailable. Enable it to sign in.');
  return globalThis.sessionStorage;
}
let storage: AuthStorage = {
  read: key => browserStorage().getItem(key),
  write: (key, value) => {
    if (value === null) browserStorage().removeItem(key);
    else browserStorage().setItem(key, value);
  },
};
export function configureAuthStorage(adapter: AuthStorage) { storage = adapter; }
export function readAuthValue(key: string): string | null { return storage.read(key); }
export function writeAuthValue(key: string, value: string | null) { storage.write(key, value); }
