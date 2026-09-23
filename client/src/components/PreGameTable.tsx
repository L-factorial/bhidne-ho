import type { ReactNode } from 'react';
import { Text } from 'react-native';
import { TableSeatLayout } from './TableSeatLayout';
import { PlayerSeat } from './PlayerSeat';
import type { RoomSnapshot } from '../screens/LiveGameTable';
import { useTheme } from '../theme';

export function PreGameTable({ snapshot, children }: { snapshot: RoomSnapshot; children: ReactNode }) {
  const { colors: c } = useTheme();
  const players = (snapshot.players || []).map(player => ({ ...player, id: String(player.player_id) }));
  return <TableSeatLayout testID="pregame-table" game={snapshot.game_type === 'marriage' ? 'marriage' : 'callbreak'} players={players} viewerId={String(snapshot.your_player_id)} capacity={Math.min(5, snapshot.capacity || 4)}
    renderSeat={player => <PlayerSeat playerId={player.player_id} name={player.display_name || `Player ${player.player_id}`} mine={player.player_id === snapshot.your_player_id} avatarUrl={player.avatar_url} connected={player.connected} status="Seated" />}>
    {snapshot.is_creator ? children : <Text style={{ textAlign: 'center', color: c.onTableHeader }}>Waiting for the host · {players.length}/{snapshot.capacity} seated</Text>}
  </TableSeatLayout>;
}
