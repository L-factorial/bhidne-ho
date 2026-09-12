import { useEffect, useRef, useState } from 'react';
import { request } from './api';
import type { PlayerPhrase } from './pokes';
import type { Session } from './session';

export function usePlayerPhrases(identity: Session | null, connected: boolean) {
  const userId = identity?.user_id || '', token = identity?.token || '';
  const [phrases, setPhrases] = useState<PlayerPhrase[]>([]);
  const [error, setError] = useState('');
  const lifetime = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const base = '/me/phrases';
  const session = { user_id: userId, token };
  useEffect(() => {
    setPhrases([]); setError(''); generation.current++;
    const controller = new AbortController(); lifetime.current = controller;
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      const version = generation.current;
      try {
        const list = await request<PlayerPhrase[]>(base, { user_id: userId, token }, undefined, controller.signal);
        if (!controller.signal.aborted && version === generation.current) { setPhrases(list); setError(''); }
      } catch (error) {
        if (!controller.signal.aborted) setError(error instanceof Error ? error.message : 'Could not load punchlines.');
      } finally { if (!controller.signal.aborted) timer = setTimeout(refresh, 2000); }
    }
    if (connected && token) void refresh();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [base, userId, token, connected]);

  function signal() {
    if (!connected || !lifetime.current || lifetime.current.signal.aborted) throw new Error('Sign in before updating your phrases.');
    return lifetime.current.signal;
  }
  async function save(text: string) {
    const active = signal(); generation.current++;
    const phrase = await request<PlayerPhrase>(base, session, { text }, active);
    generation.current++;
    if (!active.aborted) setPhrases(current => current.some(p => p.id === phrase.id) ? current : [...current, phrase]);
  }
  async function remove(id: string) {
    const active = signal(); generation.current++;
    await request(`${base}/${encodeURIComponent(id)}`, session, undefined, active, 'DELETE');
    generation.current++;
    if (!active.aborted) setPhrases(current => current.filter(p => p.id !== id));
  }
  return { phrases, error, save, remove };
}
