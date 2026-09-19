import type { TableView } from '../components/TableControls';
export type TableSummary = {
  match_id: string; name: string; game_type: 'callbreak' | 'marriage' | 'flush';
  status: string; players: number; capacity: number;
  phase?: TableView['phase']; queue_size?: number;
  seated_players?: { seat_id: number; display_name: string }[];
  current_user?: TableView['current_user'];
};
export type TableEntry = 'watch' | 'seat' | 'queue';
export function tableEntry(table: TableSummary): { label: string; action: TableEntry } {
  const me = table.current_user;
  if (table.phase === 'ENDED' || table.status === 'ended') return { label: 'View results', action: 'watch' };
  if (me?.is_seated) return { label: 'Return to table', action: 'watch' };
  if (me?.is_queued) return { label: 'Watch', action: 'watch' };
  if (table.phase === 'OPEN' && me?.can_join) return { label: 'Take seat', action: 'seat' };
  if (table.phase === 'OPEN' && me?.can_queue) return { label: 'Join queue', action: 'queue' };
  return { label: table.phase === 'COMPLETED' ? 'View results' : 'Watch', action: 'watch' };
}
export function tablePhase(table: TableSummary) {
  return table.phase ? ({ OPEN: 'Open', LOCKED: 'Ready to start', STARTED: 'Playing', COMPLETED: 'Completed', ENDED: 'Ended' })[table.phase] : table.status;
}
