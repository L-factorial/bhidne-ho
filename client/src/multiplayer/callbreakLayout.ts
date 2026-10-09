/** Room for two readable stat rows, with played cards on the inward side. */
export function callBreakSeatGeometry(count: number, width: number, fontScale = 1, measuredSeatHeight = 0) {
  const seatWidth = Math.min(144, Math.max(100, width * .36));
  const seatHeight = Math.max(Math.ceil(140 * Math.max(1, fontScale)), Math.ceil(measuredSeatHeight));
  const height = seatHeight * 4 + 80;
  const middle = width / 2, top = seatHeight / 2, bottom = height - seatHeight / 2;
  const left = seatWidth / 2, right = width - seatWidth / 2;
  const side = bottom - seatHeight;
  const positions = count === 2 ? [[middle, bottom], [middle, top]]
    : count === 3 ? [[middle, bottom], [left, top], [right, top]]
    : count === 4 ? [[middle, bottom], [left, side], [middle, top], [right, side]]
    : [[middle, bottom], [left, side], [left, top], [right, top], [right, side]];
  return { height, seatWidth, seatHeight, center: { x: middle, y: (height - seatHeight) / 2 },
    positions: positions.slice(0, count).map(([x, y]) => ({ x, y })) };
}

export function inwardTrickPosition(layout: ReturnType<typeof callBreakSeatGeometry>, index: number) {
  const seat = layout.positions[index];
  if (!seat) return layout.center;
  const top = seat.y === layout.seatHeight / 2;
  const bottom = index === 0;
  if (top || bottom) return { x: seat.x, y: seat.y + (top ? 1 : -1) * (layout.seatHeight / 2 + 36) };
  return { x: seat.x < layout.center.x ? Math.min(layout.center.x - 32, seat.x + layout.seatWidth * .3)
    : Math.max(layout.center.x + 32, seat.x - layout.seatWidth * .3), y: seat.y - layout.seatHeight / 2 - 36 };
}
