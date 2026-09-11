export type Session = { user_id: string; token: string };
export type Room = { room_id: string; name: string; members: string[] };
export type SavedSession = { session: Session; room: Room | null; game: string | null };

const memory = new Map<string, SavedSession>();
const key = (server: string) => `bhidne.session.v1:${server}`;

// Per-tab storage keeps separate browser windows available for separate players.
// Native clients retain the session in memory; device persistence can use the same interface.
export function readSession(server: string): SavedSession | null {
  try {
    const storage = globalThis.sessionStorage;
    if (!storage) return memory.get(server) || null;
    const raw = storage.getItem(key(server));
    if (!raw) return null;
    const value = JSON.parse(raw);
    if (typeof value?.session?.token !== 'string' || !value.session.token
      || typeof value.session.user_id !== 'string' || !value.session.user_id) return null;
    const room = value.room;
    return { session: value.session, game: typeof value.game === 'string' ? value.game : null,
      room: room && typeof room.room_id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(room.room_id)
        && typeof room.name === 'string' ? { room_id: room.room_id, name: room.name, members: [] } : null };
  } catch { return memory.get(server) || null; }
}

export function saveSession(server: string, value: SavedSession | null) {
  if (value) memory.set(server, value); else memory.delete(server);
  try {
    if (value) globalThis.sessionStorage?.setItem(key(server), JSON.stringify(value));
    else globalThis.sessionStorage?.removeItem(key(server));
  } catch { /* Storage may be disabled; the in-memory session still works. */ }
}
