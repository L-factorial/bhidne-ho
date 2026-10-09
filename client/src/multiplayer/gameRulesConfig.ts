import type { RoomSnapshot } from '../screens/LiveGameTable';

export function canConfigureGameRules(snapshot: RoomSnapshot) {
  return !!snapshot.is_creator && snapshot.status === 'waiting'
    && (!snapshot.table || snapshot.table.phase === 'OPEN')
    && !snapshot.flush_settings?.locked
    && snapshot.rule_proposal?.status !== 'PENDING';
}
