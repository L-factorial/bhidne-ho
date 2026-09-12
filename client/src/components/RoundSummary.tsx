import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { RoomSnapshot } from '../screens/LiveGameTable';
import { colors, fonts } from '../theme';

export function RoundSummary({ snapshot, busy, error, onContinue, onBack, onNewGame }: {
  snapshot: RoomSnapshot; busy: boolean; error: string; onContinue: () => void; onBack: () => void; onNewGame: () => void;
}) {
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
      <Text style={[styles.note, { color: (player.score_tenths || 0) < 0 ? '#FFD1C5' : '#A8E7C9' }]}>Deal {score(player.score_tenths)} · Total {score(snapshot.scoreboard?.find(p => p.player_id === player.player_id)?.total_score_tenths)}</Text>
    </View>)}
    {!!error && <Text accessibilityRole="alert" style={styles.note}>{error}</Text>}
    {!final && snapshot.play_mode === 'auto' && <Text style={styles.note}>Next deal in {Math.ceil((snapshot.remaining_ms || 0) / 1000)}s</Text>}
    {(final || snapshot.round_review?.can_continue) ? <Pressable accessibilityRole="button" disabled={busy} onPress={final ? onNewGame : onContinue}
      style={[styles.button, busy && { opacity: 0.5 }]}><Text style={styles.name}>{final ? 'Start a new game' : 'Start next deal'}</Text></Pressable>
      : <Text style={styles.note}>Waiting for the creator to start the next deal.</Text>}
    <Pressable accessibilityRole="button" onPress={onBack} style={styles.back}><Text style={styles.note}>Back to room</Text></Pressable>
  </ScrollView>;
}
const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.navy }, body: { padding: 20, gap: 16 },
  title: { fontFamily: fonts.display, fontSize: 32, color: colors.ivory }, name: { fontFamily: fonts.medium, color: colors.ivory, fontSize: 15 },
  note: { fontFamily: fonts.body, color: colors.champagne, fontSize: 13, lineHeight: 22 },
  row: { padding: 14, borderRadius: 10, backgroundColor: '#183750', gap: 6 },
  button: { minHeight: 48, padding: 14, borderRadius: 8, backgroundColor: colors.copper, alignItems: 'center' }, back: { minHeight: 44, justifyContent: 'center' },
});
