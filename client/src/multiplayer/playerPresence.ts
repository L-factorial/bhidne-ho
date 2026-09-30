// Missing or stale observations are not evidence that a seated player left.
export function playerPresence(user: string, online: readonly string[], known: boolean): boolean | null {
  return known ? online.includes(user) : null;
}
