import { Pressable, Text, View } from 'react-native';
import { ActionCue } from './ActionCue';
import type { RoomSnapshot } from '../screens/LiveGameTable';
import { fonts, primaryAction, useTheme } from '../theme';

export function TableStartCue({ snapshot, busy, onStart, onTableAction, onNewGame }: {
  snapshot: RoomSnapshot; busy: boolean; onStart: () => void; onTableAction: (command: string) => void; onNewGame: () => void;
}) {
  const { colors } = useTheme();
  const table = snapshot.table, me = table?.current_user;
  const lock = table?.requires_explicit_lock && table.phase === 'OPEN';
  const next = table?.phase === 'COMPLETED';
  const finished = snapshot.status === 'finished';
  const visible = snapshot.is_creator && (snapshot.status === 'waiting' || finished || table?.phase === 'OPEN' || table?.phase === 'LOCKED' || next);
  if (!visible) return null;
  const allowed = table ? (lock ? me?.can_lock : next ? me?.can_next_match : me?.can_start) : (finished || snapshot.ready);
  const disabled = busy || !allowed || snapshot.rule_proposal?.status === 'PENDING';
  const label = lock ? 'Lock players' : next ? 'Prepare next match' : finished && !table ? 'Start a new game' : 'Start game';
  return <View testID={`${snapshot.game_type}-center-start`} style={{ alignItems: 'center', justifyContent: 'center', minHeight: 120, padding: 12, gap: 8, backgroundColor: colors.surface, borderRadius: 18 }}>
    <Text style={{ color: colors.text, fontFamily: fonts.medium, textAlign: 'center' }}>{table?.phase === 'LOCKED' ? 'Players locked' : finished ? 'Ready for another round?' : 'Waiting for players'}</Text>
    <Text style={{ color: colors.textMuted, fontSize: 12 }}>{snapshot.players?.length || 0} of {table?.max_players || snapshot.capacity} seated</Text>
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled}
      onPress={() => lock ? onTableAction('lock') : next ? onTableAction('next-match') : finished && !table ? onNewGame() : onStart()}
      style={({ pressed }) => ({ ...primaryAction(colors, pressed), minHeight: 48, maxWidth: 260, padding: 16, borderRadius: 10, borderWidth: 1, opacity: disabled ? 0.45 : 1 })}>
      <ActionCue active={!disabled} style={{ color: colors.onPrimary, fontFamily: fonts.medium, fontSize: 15, textAlign: 'center' }}>{label}</ActionCue>
    </Pressable>
    {!allowed && <Text style={{ color: colors.textMuted, fontFamily: fonts.body, textAlign: 'center' }}>{(snapshot.players?.length || 0) < (table?.min_players || snapshot.capacity || 2) ? `Need at least ${table?.min_players || snapshot.capacity} players` : 'Waiting for eligible seats and rule approval.'}</Text>}
  </View>;
}
