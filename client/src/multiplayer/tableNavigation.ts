import { ui, uiLabel } from '../i18n/copy.ts';
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
  if (table.phase === 'ENDED' || table.status === 'ended') return { label: ui("common.view_results"), action: 'watch' };
  if (me?.is_seated) return { label: ui("common.return_to_table"), action: 'watch' };
  if (me?.is_queued) return { label: ui("rooms.watch"), action: 'watch' };
  if (table.phase === 'OPEN' && me?.can_join) return { label: ui("rooms.take_seat"), action: 'seat' };
  if (table.phase === 'OPEN' && me?.can_queue) return { label: ui("rooms.join_queue"), action: 'queue' };
  return { label: table.phase === 'COMPLETED' ? ui("common.view_results") : ui("rooms.watch"), action: 'watch' };
}
export function tablePhase(table: TableSummary) {
  return uiLabel(table.phase ? ({ OPEN: 'Open', LOCKED: 'Ready to start', STARTED: 'Playing', COMPLETED: 'Completed', ENDED: 'Ended' })[table.phase] : table.status, 'rooms');
}
