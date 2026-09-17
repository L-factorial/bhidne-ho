import { useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { apiUrl, ApiError, request } from './api';
import { readSession, saveSession, type Room, type Session } from './session';
import { RoomConnection, type ConnectionStatus } from './RoomConnection';
import { appendPoke, readPoke, type RoomPoke } from './pokes';

export function useRoomSession() {
  const [pokes, setPokes] = useState<RoomPoke[]>([]);
  const [saved] = useState(() => readSession(apiUrl));
  const [session, setSession] = useState<Session | null>(saved?.session || null);
  const [room, setRoom] = useState<Room | null>(saved?.room || null);
  const [game, setGame] = useState<string | null>(saved?.game || null);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const [error, setError] = useState('');
  const [expired, setExpired] = useState(false);
  const [abandonRequired, setAbandonRequired] = useState(false);
  const [leaveGameRequired, setLeaveGameRequired] = useState<string | null>(null);
  const connection = useRef<RoomConnection | null>(null);

  const [loggingIn, setLoggingIn] = useState(false);
  const loginPending = useRef(false);
  async function loginGuest(displayName: string) {
    if (loginPending.current || session) return;
    loginPending.current = true; setLoggingIn(true); setError('');
    try {
      const value = await request<Session>('/auth/guest', null, { display_name: displayName.trim() });
      setSession(value);
    } catch (error) { setError(error instanceof Error ? error.message : 'Could not sign in. Please try again.'); }
    finally { loginPending.current = false; setLoggingIn(false); }
  }

  async function loginAccount(username: string, password: string, signup: boolean) {
    if (loginPending.current || session) return false;
    loginPending.current = true; setLoggingIn(true); setError('');
    try {
      const value = await request<Session>(signup ? '/auth/signup' : '/auth/signin', null, {
        username: username.trim(), password,
      });
      setSession(value); setExpired(false);
      return true;
    } catch (error) {
      setError(error instanceof Error ? error.message : `Could not ${signup ? 'create your account' : 'sign in'}. Please try again.`);
      return false;
    } finally { loginPending.current = false; setLoggingIn(false); }
  }

  useEffect(() => {
    if (session && !expired) saveSession(apiUrl, { session, room, game });
  }, [session, room, game, expired]);

  useEffect(() => {
    if (!session || expired) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const result = await request<Room[]>('/rooms', session, undefined, controller.signal);
        if (!controller.signal.aborted) { setRooms(result); setError(''); }
      } catch (error) {
        if (!controller.signal.aborted) {
          if (error instanceof ApiError && error.status === 401) {
            saveSession(apiUrl, null); setExpired(true); setError(error.message); return;
          }
          setError('Connection interrupted. Retrying…');
        }
      } finally { if (!controller.signal.aborted) timer = setTimeout(refresh, 2000); }
    }
    refresh();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [session, expired]);

  useEffect(() => {
    if (!session || !room || expired) { setStatus('disconnected'); return; }
    setPokes([]);
    const transport = new RoomConnection(
      `${apiUrl.replace(/^http/, 'ws')}/ws/rooms/${encodeURIComponent(room.room_id)}?token=${encodeURIComponent(session.token)}&heartbeat=1&resume=1`,
      setStatus, undefined, message => {
      if ((message as { type?: string })?.type === 'ROOM_LEFT') {
          setRoom(null); setGame(null); setLeaveGameRequired(null); return;
        }
        if ((message as { type?: string })?.type === 'ROOM_DELETED') {
          setRoom(null); setGame(null); setLeaveGameRequired(null); setError('This room was deleted by its owner.'); return;
        }
        const poke = readPoke(message, room.room_id, session.user_id);
        if (poke) setPokes(current => appendPoke(current, poke));
      },
    );
    connection.current = transport; transport.start();
    const wake = () => transport.retryNow();
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') wake(); });
    if (Platform.OS === 'web') globalThis.addEventListener('online', wake);
    return () => {
      transport.stop(); connection.current = null; subscription.remove();
      if (Platform.OS === 'web') globalThis.removeEventListener('online', wake);
    };
  }, [session, room?.room_id, expired]);

  async function joinRoom(target: Room, selectedGame: string | null = null) {
    if (!session || expired) return false;
    try {
      await request(`/rooms/${encodeURIComponent(target.room_id)}/enter`, session, {});
      setStatus('connecting'); setRoom(target); setGame(selectedGame); setLeaveGameRequired(null); setError('');
      return true;
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not enter the room.');
      return false;
    }
  }
  async function leaveRoom() {
    if (room && session && !expired) {
      try {
        await request(`/rooms/${encodeURIComponent(room.room_id)}/leave`, session, {});
      } catch (error) {
        if (error instanceof ApiError && error.detail?.requires_leave_game) {
          setLeaveGameRequired(error.detail.match_id || null);
          setAbandonRequired(error.detail.departure_command === 'abandon');
        }
        setError(error instanceof Error ? error.message : 'Could not leave the room.');
        return false;
      }
    }
    connection.current?.stop(); setStatus('disconnected'); setRoom(null); setGame(null); setLeaveGameRequired(null); setError('');
    if (session && !expired) saveSession(apiUrl, { session, room: null, game: null });
    return true;
  }
  async function deleteRoom() {
    if (!room || !session || expired) return false;
    try {
      await request(`/rooms/${encodeURIComponent(room.room_id)}`, session, undefined, undefined, 'DELETE');
      connection.current?.stop(); setStatus('disconnected'); setRoom(null); setGame(null); setError('');
      saveSession(apiUrl, { session, room: null, game: null });
      return true;
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not delete the room.');
      return false;
    }
  }
  async function leaveGameAndRoom() {
    if (!room || !session || !leaveGameRequired) return false;
    try {
      await request(`/test-games/${encodeURIComponent(room.room_id)}/${abandonRequired ? 'table/abandon' : 'leave'}`, session, { match_id: leaveGameRequired });
      return await leaveRoom();
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not leave the game.');
      return false;
    }
  }
  async function signOut() {
    connection.current?.stop();
    const active = session;
    saveSession(apiUrl, null); setSession(null); setRoom(null); setGame(null);
    if (active) {
      try { await request('/auth/signout', active, {}); } catch { /* Local sign-out still succeeds offline. */ }
    }
  }
  return { loginGuest, loginAccount, loggingIn, session, room, rooms, game, setGame, joinRoom, leaveRoom, deleteRoom, signOut, leaveGameRequired, leaveGameAndRoom, abandonRequired,
    cancelLeave: () => { setLeaveGameRequired(null); setError(''); }, status, expired, error, pokes,
    retry: () => { connection.current?.retryNow(); } };
}
