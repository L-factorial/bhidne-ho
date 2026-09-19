export type FlushBet = { sequence: number; player_id: string; amount: number; kind: string };
export function playerPosition(index: number, count: number, width: number, height = 370) {
  // Equal arc lengths keep seats apart at the narrow ends of a tall oval.
  const rx = Math.max(60, width / 2 - 44), ry = height / 2 - 52;
  const points = Array.from({ length: 361 }, (_, step) => {
    const angle = Math.PI / 2 + step * Math.PI / 180;
    return { x: width / 2 + Math.cos(angle) * rx, y: height / 2 + Math.sin(angle) * ry };
  });
  const lengths = [0];
  for (let i = 1; i < points.length; i++) lengths.push(lengths[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y));
  const target = lengths[360] * index / Math.max(1, count);
  const end = Math.max(1, lengths.findIndex(length => length >= target));
  const fraction = (target - lengths[end - 1]) / (lengths[end] - lengths[end - 1]);
  return { x: points[end - 1].x + (points[end].x - points[end - 1].x) * fraction,
    y: points[end - 1].y + (points[end].y - points[end - 1].y) * fraction };
}
export function newBets(bets: FlushBet[], after: number) { return bets.filter(b => b.sequence > after); }
export function potBeforeFlights(pot: number, pending: FlushBet[]) { return Math.max(0, pot - pending.reduce((sum, b) => sum + b.amount, 0)); }

export function minimumArenaHeight(count: number, width: number) {
  // A short/narrow viewport can scroll the table while actions remain anchored.
  for (let height = 280; ; height += 16) {
    const seats = Array.from({ length: count }, (_, i) => playerPosition(i, count, width, height));
    if (seats.every((seat, i) => seats.slice(i + 1).every(other =>
      Math.abs(seat.x - other.x) >= 80 || Math.abs(seat.y - other.y) >= 86))) return height;
  }
}
