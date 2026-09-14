export type Invitation = { roomId: string; matchId?: string };
const roomIdPattern = /^[A-Za-z0-9_-]{1,64}$/;
const matchIdPattern = /^[A-Za-z0-9_-]{1,128}$/;
export function readInvitation(value: string): Invitation | null {
  try {
    const url = new URL(value);
    if (!['http:', 'https:', 'bhidneho:'].includes(url.protocol)) return null;
    const roomId = url.searchParams.get('room');
    const matchId = url.searchParams.get('match');
    if (!roomId || !roomIdPattern.test(roomId) || (matchId !== null && !matchIdPattern.test(matchId))) return null;
    return { roomId, ...(matchId ? { matchId } : {}) };
  } catch { return null; }
}
export function invitationLink(base: string, invitation: Invitation): string {
  const url = new URL(base);
  // Never copy credentials or unrelated state from the current address.
  url.search = ''; url.hash = '';
  url.searchParams.set('room', invitation.roomId);
  if (invitation.matchId) url.searchParams.set('match', invitation.matchId);
  return url.toString();
}
