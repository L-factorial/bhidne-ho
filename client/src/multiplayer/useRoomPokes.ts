import { ui } from '../i18n/copy.ts';
import { useEffect, useRef } from 'react';
import { request } from './api';

export function useRoomPokes(roomId: string, userId: string, token: string, connected: boolean) {
  const lifetime = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController(); lifetime.current = controller;
    return () => controller.abort();
  }, [roomId, userId, token, connected]);
  async function send(matchId: string, recipient: number | null, text: string) {
    if (!connected || !lifetime.current || lifetime.current.signal.aborted) throw new Error(ui("feedback.reconnect_before_sending_a_poke"));
    await request(`/test-games/${encodeURIComponent(roomId)}/poke`, { user_id: userId, token },
      { match_id: matchId, recipient_player_id: recipient, text }, lifetime.current.signal);
  }
  return { send };
}
