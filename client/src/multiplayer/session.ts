import { setSessionNotice } from '../auth/sessionNotice.ts';
import { readAuthValue, writeAuthValue } from '../auth/storage.ts';

export type Session = { user_id: string; token: string };
export type Room = { room_id: string; name: string; members: string[]; connected_members?: string[];
  presence_status?: 'observed'|'unknown'|'overflow';
  table_count?: number; member_previews?: { user_id: string; display_name: string; username?: string | null }[];
  creator_is_friend?: boolean; creator_id?: string | null; visibility?: 'public' | 'private' | 'friends'; created_at?: number | null;
  feed_source?: 'you' | 'joined' | 'friend' | 'public' };
export type SavedSession = { session: Session; room: Room | null; game: string | null };

const memory = new Map<string, SavedSession | null>();
const versions = new Map<string, number>();
const key = (server: string) => `bhidne.session.v1:${server}`;

// Per-tab storage keeps separate browser windows available for separate players.
// Native credentials use platform secure storage via the platform-specific adapter.
export function readSession(server: string): SavedSession | null {
  if (memory.has(server)) return memory.get(server)!;
  try {
    const raw = readAuthValue(key(server));
    if (!raw) return null;
    const value = JSON.parse(raw);
    if (typeof value?.session?.token !== 'string' || !value.session.token
      || typeof value.session.user_id !== 'string' || !value.session.user_id) return null;
    const room = value.room;
    const restored: SavedSession = { session: {user_id: value.session.user_id, token: value.session.token}, game: typeof value.game === 'string' ? value.game : null,
      room: room && typeof room.room_id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(room.room_id)
        && typeof room.name === 'string' ? { room_id:room.room_id, name:room.name, members:[] } : null };
    memory.set(server, restored);
    return restored;
  } catch { setSessionNotice(server, 'storage', 'storage_read_failed'); return null; }
}

export function saveSession(server: string, value: SavedSession | null) {
  // The latest choice, including a logout tombstone, wins even when storage fails.
  if (memory.get(server)?.session.token !== value?.session.token) versions.set(server, (versions.get(server) || 0) + 1);
  memory.set(server, value);
  try {
    writeAuthValue(key(server), value ? JSON.stringify({session:value.session,game:value.game,room:value.room ? {room_id:value.room.room_id,name:value.room.name,members:[]} : null}) : null);
    setSessionNotice(server, 'storage');
    return true;
  } catch {
    setSessionNotice(server, 'storage', value ? 'storage_save_failed' : 'storage_clear_failed');
    return false;
  }
}

export function isCurrentSession(server: string, session: Session | null) {
  return !!session && readSession(server)?.session.token === session.token;
}

/** Local removal always happens first. Never retry against a different account. */
export async function signOutSession(server: string, active: Session | null, revoke: (session: Session) => Promise<unknown>) {
  if (active && !isCurrentSession(server, active)) return;
  saveSession(server, null);
  const version = versions.get(server);
  setSessionNotice(server, 'auth');
  if (!active) return;
  try { await revoke(active); }
  catch (error) {
    // An expired/revoked token is already signed out on the server.
    if ((error as {status?: number})?.status !== 401 && versions.get(server) === version && !readSession(server)) {
      setSessionNotice(server, 'auth', 'signed_out_local');
    }
  }
}

export function retrySessionStorage(server: string) {
  if (memory.has(server)) return saveSession(server, memory.get(server)!);
  return false;
}
