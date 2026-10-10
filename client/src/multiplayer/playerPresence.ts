// Missing or stale observations are not evidence that a seated player left.
export function playerPresence(user: string, online: readonly string[], known: boolean, self?: { user: string; connected: boolean }): boolean | null {
  if (user === self?.user) return self.connected ? true : null;
  return known ? online.includes(user) : null;
}
