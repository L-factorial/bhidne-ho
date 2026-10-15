import type { RoomSnapshot } from '../screens/LiveGameTable';

export function canConfigureGameRules(snapshot: RoomSnapshot) {
  return !!snapshot.is_creator && (snapshot.status === 'waiting' || snapshot.status === 'finished' || snapshot.flush?.public.status === 'finished')
    && (!snapshot.table || ['OPEN', 'LOCKED', 'COMPLETED'].includes(snapshot.table.phase))
    && !snapshot.flush_settings?.locked;
}
