import { readAuthValue, writeAuthValue } from '../auth/storage.ts';

export type Session = { user_id: string; token: string };
export type Room = { room_id: string; name: string; members: string[]; connected_members?: string[];
  creator_id?: string | null; visibility?: 'public' | 'friends'; created_at?: number | null;
  feed_source?: 'you' | 'joined' | 'friend' | 'public' };
export type SavedSession = { session: Session; room: Room | null; game: string | null };

const memory = new Map<string, SavedSession>();
const key = (server: string) => `bhidne.session.v1:${server}`;

// Per-tab storage keeps separate browser windows available for separate players.
// Native credentials use platform secure storage via the platform-specific adapter.
export function readSession(server: string): SavedSession | null {
  try {
    const raw = readAuthValue(key(server));
    if (!raw) return null;
    const value = JSON.parse(raw);
    if (typeof value?.session?.token !== 'string' || !value.session.token
      || typeof value.session.user_id !== 'string' || !value.session.user_id) return null;
    const room = value.room;
    return { session: value.session, game: typeof value.game === 'string' ? value.game : null,
      room: room && typeof room.room_id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(room.room_id)
        && typeof room.name === 'string' ? { ...room, members: [] } : null };
  } catch { return memory.get(server) || null; }
}

export function saveSession(server: string, value: SavedSession | null) {
  if (value) memory.set(server, value); else memory.delete(server);
  try {
    writeAuthValue(key(server), value ? JSON.stringify(value) : null);
  } catch { /* Storage may be disabled; the in-memory session still works. */ }
}
