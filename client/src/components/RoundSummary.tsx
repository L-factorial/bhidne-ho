import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { RoomSnapshot } from '../screens/LiveGameTable';
import { fonts, useTheme, useThemedStyles, type ThemeColors } from '../theme';

export function RoundSummary({ snapshot, busy, error, onContinue, onBack, onNewGame }: {
  snapshot: RoomSnapshot; busy: boolean; error: string; onContinue: () => void; onBack: () => void; onNewGame: () => void;
}) {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const round = [...(snapshot.deal_history || [])].reverse().find(d => d.complete);
  const final = snapshot.game?.finished;
  const name = (id: number) => snapshot.players?.find(p => p.player_id === id)?.display_name || `Player ${id}`;
  const score = (n: number | null | undefined) => n == null ? '—' : (n / 10).toFixed(1);
  return <ScrollView testID="round-summary" style={styles.page} contentContainerStyle={styles.body}>
    <Text accessibilityRole="header" style={styles.title}>{final ? 'Final scores' : `Deal ${round?.deal_number} complete`}</Text>
    {final && <Text style={styles.note}>Winner{snapshot.game!.winners.length > 1 ? 's' : ''}: {snapshot.game!.winners.map(name).join(', ')}</Text>}
    {round?.players.map(player => <View key={player.player_id} style={styles.row}>
      <Text style={styles.name}>{name(player.player_id)}{player.player_id === snapshot.your_player_id ? ' · You' : ''}</Text>
      <Text style={styles.note}>Bid {player.bid} · Won {player.tricks_won}</Text>
      <Text style={[styles.note, { color: (player.score_tenths || 0) < 0 ? colors.danger : colors.success }]}>Deal {score(player.score_tenths)} · Total {score(snapshot.scoreboard?.find(p => p.player_id === player.player_id)?.total_score_tenths)}</Text>
    </View>)}
    {!!error && <Text accessibilityRole="alert" style={styles.note}>{error}</Text>}
    {(final || snapshot.round_review?.can_continue) ? <Pressable accessibilityRole="button" disabled={busy} onPress={final ? onNewGame : onContinue}
      style={[styles.button, busy && { opacity: 0.5 }]}><Text style={styles.name}>{final ? 'Start a new game' : 'Start next deal'}</Text></Pressable>
      : <Text style={styles.note}>Waiting for the creator to start the next deal.</Text>}
    <Pressable accessibilityRole="button" onPress={onBack} style={styles.back}><Text style={styles.note}>Back to room</Text></Pressable>
  </ScrollView>;
}
const createStyles = (colors: ThemeColors) => StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background }, body: { padding: 20, gap: 16 },
  title: { fontFamily: fonts.display, fontSize: 32, color: colors.text }, name: { fontFamily: fonts.medium, color: colors.text, fontSize: 15 },
  note: { fontFamily: fonts.body, color: colors.accent, fontSize: 13, lineHeight: 22 },
  row: { padding: 14, borderRadius: 10, backgroundColor: colors.surface, gap: 6 },
  button: { minHeight: 48, padding: 14, borderRadius: 8, backgroundColor: colors.surfaceSelected, alignItems: 'center' }, back: { minHeight: 44, justifyContent: 'center' },
});
