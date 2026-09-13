import { useEffect, useMemo, useState } from 'react';

// Only reveal progress is stored; private card faces never enter storage.
const progress = new Map<string, number>();
function readProgress(key: string) {
  try {
    const value = Number(globalThis.sessionStorage?.getItem(key) || progress.get(key) || 0);
    return Number.isInteger(value) && value >= 0 && value <= 21 ? value : 0;
  } catch { return progress.get(key) || 0; }
}

export function useMarriageReveal(matchId: string | undefined, playerId: string | undefined, playStarted: boolean) {
  const key = `bhidne.marriage-reveal:${matchId || ''}:${playerId || ''}`;
  const restored = useMemo(() => readProgress(key), [key]);
  const [state, setState] = useState({ key, count: restored });
  const revealed = playStarted ? 21 : state.key === key ? state.count : restored;
  useEffect(() => {
    if (!matchId || !playerId) return;
    progress.set(key, revealed);
    try { globalThis.sessionStorage?.setItem(key, String(revealed)); } catch { /* In-memory fallback. */ }
  }, [key, matchId, playerId, revealed]);
  function reveal(all = false) {
    setState(current => ({ key, count: all ? 21 : Math.min(21, (current.key === key ? current.count : restored) + 1) }));
  }
  return { revealed, reveal };
}
