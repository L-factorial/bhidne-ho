import { Text, View } from 'react-native';
import { FloatingTableAction } from './FloatingTableAction';
import type { RoomSnapshot } from '../screens/LiveGameTable';
import { fonts, useTheme } from '../theme';

export function TableStartCue({ snapshot, busy, onStart, onTableAction, onNewGame }: {
  snapshot: RoomSnapshot; busy: boolean; onStart: () => void; onTableAction: (command: string) => void; onNewGame: () => void;
}) {
  const { colors } = useTheme();
  const table = snapshot.table, me = table?.current_user;
  const lock = table?.requires_explicit_lock && table.phase === 'OPEN';
  const next = table?.phase === 'COMPLETED';
  const finished = snapshot.status === 'finished';
  const host = table ? !!me?.is_seated && table.seated_players[0]?.seat_id === me.seat_id : snapshot.is_creator;
  const seatCount = table?.seated_players.length ?? snapshot.players?.length ?? 0;
  const visible = host && (snapshot.status === 'waiting' || finished || table?.phase === 'OPEN' || table?.phase === 'LOCKED' || next);
  if (!visible) return null;
  const allowed = table ? (lock ? me?.can_lock : next ? me?.can_next_match : me?.can_start) : (finished || snapshot.ready);
  const disabled = busy || !allowed || snapshot.rule_proposal?.status === 'PENDING';
  const label = lock ? 'Lock players' : next ? 'Prepare next match' : finished && !table ? 'Start a new game' : 'Start game';
  return <View testID={`${snapshot.game_type}-center-start`} style={{ alignItems: 'center', justifyContent: 'center', minHeight: 120, padding: 12, gap: 8, backgroundColor: 'transparent', borderRadius: 18 }}>
    <Text style={{ color: colors.text, fontFamily: fonts.medium, textAlign: 'center' }}>{table?.phase === 'LOCKED' ? 'Players locked' : finished ? 'Ready for another round?' : 'Waiting for players'}</Text>
    <Text style={{ color: colors.textMuted, fontSize: 12 }}>{seatCount} of {table?.max_players || snapshot.capacity} seated</Text>
    <FloatingTableAction label={label} disabled={disabled}
      onPress={() => lock ? onTableAction('lock') : next ? onTableAction('next-match') : finished && !table ? onNewGame() : onStart()} />
    {!allowed && <Text style={{ color: colors.textMuted, fontFamily: fonts.body, textAlign: 'center' }}>{(seatCount) < (table?.min_players || snapshot.capacity || 2) ? `Need at least ${table?.min_players || snapshot.capacity} players` : 'Waiting for eligible seats and rule approval.'}</Text>}
  </View>;
}
