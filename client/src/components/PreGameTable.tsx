import { ui } from '../i18n/copy.ts';
import { useUiLanguage } from '../i18n/useUiLanguage';
import type { ReactNode } from 'react';
import { TableSeatLayout } from './TableSeatLayout';
import { PlayerSeat } from './PlayerSeat';
import type { RoomSnapshot } from '../screens/LiveGameTable';

export function PreGameTable({ snapshot, children, fill = false }: { snapshot: RoomSnapshot; children: ReactNode; fill?: boolean }) {
  useUiLanguage();
  const players = (snapshot.players || []).map(player => ({ ...player, id: String(player.player_id) }));
  return <TableSeatLayout fill={fill} testID="pregame-table" game={snapshot.game_type === 'marriage' ? 'marriage' : 'callbreak'} players={players} viewerId={String(snapshot.your_player_id)} capacity={Math.min(5, snapshot.capacity || 4)}
    renderSeat={player => <PlayerSeat playerId={player.player_id} name={player.display_name || `Player ${player.player_id}`} mine={player.player_id === snapshot.your_player_id} avatarUrl={player.avatar_url} connected={player.connected} status={ui("flush.seated")} />}>
    {children}
  </TableSeatLayout>;
}
