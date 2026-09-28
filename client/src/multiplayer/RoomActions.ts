import type { Room, Session } from './session';

export type CreateRoomInput = {
  name: string;
  visibility: 'public' | 'private';
  invitees: string[];
};

// Screen-level contract: resolving means committed success, not merely queued.
// Navigation and presentation stay with the existing screens.
export interface RoomActions {
  create(session: Session, input: CreateRoomInput): Promise<Room>;
  enter(session: Session, roomId: string): Promise<void>;
  leave(session: Session, roomId: string): Promise<void>;
  remove(session: Session, roomId: string): Promise<void>;
}
