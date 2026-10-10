export function cardDragAngle(initial: number, dx: number, dy: number, radius = 170) {
  const radians = initial * Math.PI / 180;
  const x = radius * Math.sin(radians) + dx;
  const y = radius * Math.cos(radians) - dy;
  return Math.max(-85, Math.min(85, Math.atan2(x, y) * 180 / Math.PI));
}
