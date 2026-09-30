export type SessionNotice = 'storage_read_failed' | 'storage_save_failed' | 'storage_clear_failed' | 'signed_out_local' | 'session_ended';
const notices = new Map<string, Partial<Record<'storage' | 'auth', SessionNotice>>>();
const listeners = new Set<() => void>();
export function setSessionNotice(server: string, kind: 'storage' | 'auth', value?: SessionNotice) {
  const current = notices.get(server) || {};
  if (current[kind] === value) return;
  notices.set(server, {...current, [kind]: value});
  queueMicrotask(() => listeners.forEach(listener => listener()));
}
export const subscribeSessionNotice = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const sessionNotice = (server: string) => {
  const value = notices.get(server);
  return [value?.storage, value?.auth].filter(Boolean).join(',');
};
