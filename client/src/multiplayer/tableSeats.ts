// Spatial presentation only; preserve clockwise server seating and rotate the viewer down.
export function seatedOrder<T extends { id: string }>(players: T[], viewerId: string): T[] {
  const own = players.findIndex(player => player.id === viewerId);
  return own < 0 ? players : [...players.slice(own), ...players.slice(0, own)];
}
export function tableSeatGeometry(count: number, width: number, compact = false, availableHeight?: number) {
  const height = compact ? 260 : Math.max(360, Math.min(560, availableHeight || 360));
  const seatWidth = compact ? 68 : 80, seatHeight = compact ? 68 : 88;
  const middle = width / 2, sideY = height * (compact ? .66 : .73);
  const top = seatHeight / 2, bottom = height - seatHeight / 2;
  const left = seatWidth / 2, right = width - seatWidth / 2;
  const positions = count === 2 ? [[middle, bottom], [middle, top]]
    : count === 3 ? [[middle, bottom], [width * .25, top], [width * .75, top]]
    : count === 4 ? [[middle, bottom], [left, sideY], [middle, top], [right, sideY]]
    : [[middle, bottom], [left, sideY], [width * .26, top], [width * .74, top], [right, sideY]];
  return { height, seatWidth, seatHeight, center: { x: middle, y: height * (compact ? .5 : .42) },
    positions: positions.slice(0, count).map(([x, y]) => ({ x, y })) };
}
