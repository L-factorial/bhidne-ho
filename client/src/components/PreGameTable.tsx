import { ui } from '../i18n/copy.ts';
import { useUiLanguage } from '../i18n/useUiLanguage';
import type { ReactNode } from 'react';
import { TableSeatLayout } from './TableSeatLayout';
import { PlayerSeat } from './PlayerSeat';
import type { RoomSnapshot } from '../screens/LiveGameTable';

export function PreGameTable({ snapshot, children, fill = false }: { snapshot: RoomSnapshot; children: ReactNode; fill?: boolean }) {
  useUiLanguage();
  const roster = snapshot.table?.phase === 'COMPLETED' ? snapshot.table.seated_players.map(p=>({player_id:p.seat_id,user_id:p.user_id,display_name:p.display_name,avatar_url:p.avatar_url,connected:true})) : snapshot.players || [];
  const players = roster.map(player => ({ ...player, id: String(player.player_id) }));
  return <TableSeatLayout fill={fill} testID="pregame-table" game={snapshot.game_type === 'marriage' ? 'marriage' : 'callbreak'} players={players} viewerId={String(snapshot.your_player_id)} capacity={Math.min(snapshot.game_type==='marriage'?6:5, snapshot.capacity || 4)}
    renderSeat={player => <PlayerSeat playerId={player.player_id} name={player.display_name || `Player ${player.player_id}`} mine={player.player_id === snapshot.your_player_id} avatarUrl={player.avatar_url} connected={player.connected} status={ui("flush.seated")} />}>
    {children}
  </TableSeatLayout>;
}
