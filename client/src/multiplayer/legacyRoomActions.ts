import { request } from './api';
import { leaveRoomMembership } from './leaveRoomMembership';
import type { RoomActions } from './RoomActions';
import type { Room } from './session';

export const legacyRoomActions: RoomActions = {
  create: (session, input) => request<Room>('/rooms', session, input),
  enter: async (session, roomId) => { await request(`/rooms/${encodeURIComponent(roomId)}/enter`, session, {}); },
  leave: (session, roomId) => leaveRoomMembership(roomId, session),
  remove: async (session, roomId) => { await request(`/rooms/${encodeURIComponent(roomId)}`, session, undefined, undefined, 'DELETE'); },
};
