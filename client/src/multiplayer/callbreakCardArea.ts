/** Deliberate upward intent, kept separate from ordinary hand rearrangement. */
export function isCallBreakThrow(dx: number, dy: number, vy: number): boolean {
  return dy <= -90 && -dy >= Math.abs(dx) * 1.35 && (dy <= -150 || vy <= -0.65);
}

export function callBreakCardArea(width: number, height: number, count: number) {
  const stageHeight = Math.max(120, Math.min(190, height * .24));
  const spread = Math.min(100, Math.max(0, count - 1) * 9);
  const half = spread * Math.PI / 360;
  const scale = Math.min(1, (width - 24) / (2 * (142 * Math.sin(half) + 30 + 8)), (stageHeight - 24) / 172);
  const columns = Math.max(4, Math.min(7, Math.floor(width / 44)));
  const rows = Math.max(1, Math.ceil(count / columns));
  const gridHeight = Math.min(76, (stageHeight - 12 - (rows - 1) * 5) / rows);
  return {stageHeight, spread, cardWidth:60 * scale, cardHeight:142 * scale,
    gridHeight, gridWidth:Math.min((width - (columns - 1) * 5) / columns, gridHeight * .72), columns};
}
