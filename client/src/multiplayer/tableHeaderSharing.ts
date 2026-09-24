import type { RoomSnapshot } from '../screens/LiveGameTable';

/** Header shortcut only; sharing remains available in the table menu. */
export function showTableHeaderShare(snapshot: RoomSnapshot): boolean {
  if (!snapshot.match_id || !snapshot.room_id || snapshot.status === 'ended' || snapshot.status === 'empty') return false;
  const seated = snapshot.table?.current_user.is_seated ?? (snapshot.your_player_id != null);
  if (!seated) return true;
  // Flush keeps its table alive between rounds, so its outer status stays playing.
  const betweenRounds = snapshot.table?.phase === 'COMPLETED' || snapshot.table?.phase === 'OPEN' || snapshot.flush?.public.status === 'finished';
  return snapshot.status !== 'playing' || betweenRounds;
}
