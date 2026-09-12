import { useEffect, useRef, useState } from 'react';
import { request } from './api';
import type { RoomPhrase } from './pokes';

export function useRoomPokes(roomId: string, userId: string, token: string, connected: boolean) {
  const [phrases, setPhrases] = useState<RoomPhrase[]>([]);
  const [error, setError] = useState('');
  const lifetime = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const base = `/rooms/${encodeURIComponent(roomId)}/phrases`;
  const session = { user_id: userId, token };
  useEffect(() => {
    const controller = new AbortController(); lifetime.current = controller;
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      const version = generation.current;
      try {
        const list = await request<RoomPhrase[]>(base, { user_id: userId, token }, undefined, controller.signal);
        if (!controller.signal.aborted && version === generation.current) { setPhrases(list); setError(''); }
      } catch (error) {
        if (!controller.signal.aborted) setError(error instanceof Error ? error.message : 'Could not load punchlines.');
      } finally { if (!controller.signal.aborted) timer = setTimeout(refresh, 2000); }
    }
    if (connected) void refresh();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [base, userId, token, connected]);

  function signal() {
    if (!connected || !lifetime.current || lifetime.current.signal.aborted) throw new Error('Reconnect before sending a poke.');
    return lifetime.current.signal;
  }
  async function save(text: string) {
    const active = signal(); generation.current++;
    const phrase = await request<RoomPhrase>(base, session, { text }, active);
    generation.current++;
    if (!active.aborted) setPhrases(current => current.some(p => p.id === phrase.id) ? current : [...current, phrase]);
  }
  async function remove(id: string) {
    const active = signal(); generation.current++;
    await request(`${base}/${encodeURIComponent(id)}`, session, undefined, active, 'DELETE');
    generation.current++;
    if (!active.aborted) setPhrases(current => current.filter(p => p.id !== id));
  }
  async function send(matchId: string, recipient: number | null, text: string) {
    await request(`/test-games/${encodeURIComponent(roomId)}/poke`, session,
      { match_id: matchId, recipient_player_id: recipient, text }, signal());
  }
  return { phrases, error, save, remove, send };
}
