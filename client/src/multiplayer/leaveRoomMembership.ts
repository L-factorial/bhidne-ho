import { ApiError, request } from './api';
import type { Session } from './session';

// The server may commit a departure before its response is lost. Reconcile that
// ambiguous result instead of showing an error that the next lobby poll clears.
export async function leaveRoomMembership(roomId: string, session: Session) {
  try {
    await request('/rooms/' + encodeURIComponent(roomId) + '/leave', session, {});
  } catch (error) {
    // Keep authorization and active-game errors intact, including their details.
    if (error instanceof ApiError) throw error;
    try {
      const memberships = await request<{room_id: string}[]>('/memberships', session);
      if (!memberships.some(item => item.room_id === roomId)) return;
    } catch {
      // An unavailable verification request is not evidence of a successful leave.
    }
    throw new Error('Could not confirm leaving this room. Please try again.');
  }
}
