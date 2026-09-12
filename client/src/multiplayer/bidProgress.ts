export function bidProgress(bid: number, won: number, remaining?: number) {
  const need = Math.max(0, bid - won);
  if (bid <= 0) return { text: 'Bid pending', state: 'pending' };
  if (need === 0) return { text: 'Met', state: 'met' };
  if (remaining !== undefined && need > Math.max(0, remaining)) return { text: 'Cannot reach bid', state: 'missed' };
  return { text: `Need ${need}`, state: 'chasing' };
}
