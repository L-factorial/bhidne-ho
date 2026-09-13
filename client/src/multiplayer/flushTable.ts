export type FlushBet = { sequence: number; player_id: string; amount: number; kind: string };
export function playerPosition(index: number, count: number, width: number, height = 370) {
  const angle = Math.PI / 2 + index * Math.PI * 2 / count;
  return { x: width / 2 + Math.cos(angle) * Math.max(60, width / 2 - 44), y: height / 2 + Math.sin(angle) * (height / 2 - 48) };
}
export function newBets(bets: FlushBet[], after: number) { return bets.filter(b => b.sequence > after); }
export function potBeforeFlights(pot: number, pending: FlushBet[]) { return Math.max(0, pot - pending.reduce((sum, b) => sum + b.amount, 0)); }
