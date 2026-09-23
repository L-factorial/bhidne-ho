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

export function roomInvitationCode(roomId: string): string {
  return `r-${roomId}`;
}

/** A table code includes its room so it resolves without a public table lookup. */
export function tableInvitationCode(roomId: string, matchId: string): string {
  return `t-${roomId}:${matchId}`;
}
export function readJoinTarget(value: string): Invitation | null {
  const text = value.trim();
  const link = readInvitation(text);
  if (link) return link;
  if (/^r-/i.test(text)) {
    const roomId = text.slice(2);
    return roomIdPattern.test(roomId) ? { roomId } : null;
  }
  if (/^t-/i.test(text)) {
    const parts = text.slice(2).split(':');
    return parts.length === 2 && roomIdPattern.test(parts[0]) && matchIdPattern.test(parts[1])
      ? { roomId: parts[0], matchId: parts[1] } : null;
  }
  const parts = text.split(':');
  if (parts.length === 3 && parts[0] === 'table' && roomIdPattern.test(parts[1]) && matchIdPattern.test(parts[2]))
    return { roomId: parts[1], matchId: parts[2] };
  return roomIdPattern.test(text) ? { roomId: text } : null;
}
