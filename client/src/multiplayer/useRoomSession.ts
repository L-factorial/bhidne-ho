import { useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { apiUrl, ApiError, request } from './api';
import { readSession, saveSession, type Room, type Session } from './session';
import { RoomConnection, type ConnectionStatus } from './RoomConnection';

export function useRoomSession() {
  const [saved] = useState(() => readSession(apiUrl));
  const [session, setSession] = useState<Session | null>(saved?.session || null);
  const [room, setRoom] = useState<Room | null>(saved?.room || null);
  const [game, setGame] = useState<string | null>(saved?.game || null);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const [error, setError] = useState('');
  const [expired, setExpired] = useState(false);
  const [retry, setRetry] = useState(0);
  const connection = useRef<RoomConnection | null>(null);

  useEffect(() => {
    if (session) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function enter() {
      try {
        const value = await request<Session>('/auth/guest', null, {}, controller.signal);
        if (!controller.signal.aborted) { setSession(value); setError(''); }
      } catch {
        if (!controller.signal.aborted) {
          setError('Unable to reach the server. Retrying…'); timer = setTimeout(enter, 3000);
        }
      }
    }
    enter();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [session, retry]);

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
    const transport = new RoomConnection(
      `${apiUrl.replace(/^http/, 'ws')}/ws/rooms/${encodeURIComponent(room.room_id)}?token=${encodeURIComponent(session.token)}&heartbeat=1`,
      setStatus,
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

  function joinRoom(target: Room) {
    if (!session || expired) return;
    setStatus('connecting'); setRoom(target); setGame(null); setError('');
  }
  function leaveRoom() {
    connection.current?.stop(); setStatus('disconnected'); setRoom(null); setGame(null); setError('');
    if (session && !expired) saveSession(apiUrl, { session, room: null, game: null });
  }
  function signOut() { connection.current?.stop(); saveSession(apiUrl, null); }
  return { session, room, rooms, game, setGame, joinRoom, leaveRoom, signOut, status, expired, error,
    retry: () => { connection.current?.retryNow(); setRetry(value => value + 1); } };
}
