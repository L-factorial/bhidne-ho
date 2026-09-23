import { gameControlFinish, gameHeadingFinish, fonts, useTheme, useThemedStyles, type ThemeColors } from '../theme';
import { RoundResultsTable } from './RoundResultsTable';
import type { ReactNode } from 'react';
import { ActionCue } from './ActionCue';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { RoomSnapshot } from '../screens/LiveGameTable';

export function RoundSummary({ snapshot, busy, error, onContinue, onBack, onNewGame, controls, hideNavigation = false }: {
  controls?: ReactNode; hideNavigation?: boolean;
  snapshot: RoomSnapshot; busy: boolean; error: string; onContinue: () => void; onBack: () => void; onNewGame: () => void;
}) {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const round = [...(snapshot.deal_history || [])].reverse().find(d => d.complete);
  const final = snapshot.game?.finished;
  const name = (id: number) => snapshot.players?.find(p => p.player_id === id)?.display_name || `Player ${id}`;
  const score = (n: number | null | undefined) => n == null ? '—' : `${n > 0 ? '+' : ''}${(n / 10).toFixed(1)}`;
  return <ScrollView testID="round-summary" style={styles.page} contentContainerStyle={styles.body}>
    <RoundResultsTable title={final ? 'Final scores' : `Deal ${round?.deal_number} complete`}
      subtitle={final ? `Winner${snapshot.game!.winners.length > 1 ? 's' : ''}: ${snapshot.game!.winners.map(name).join(', ')}` : 'Round complete · Call Break'}
      columns={['Bid', 'Taken', 'Score', 'Total']} rows={(round?.players || []).map(player => {
        const total = snapshot.scoreboard?.find(p => p.player_id === player.player_id)?.total_score_tenths;
        return { id: String(player.player_id), name: name(player.player_id), avatarUrl: snapshot.players?.find(p => p.player_id === player.player_id)?.avatar_url,
          own: player.player_id === snapshot.your_player_id, winner: final && snapshot.game!.winners.includes(player.player_id), values: [
            { text: String(player.bid ?? '—') }, { text: String(player.tricks_won) },
            { text: score(player.score_tenths), amount: player.score_tenths ?? undefined }, { text: score(total), amount: total },
          ] };
      })} />
    {controls}
    {!!error && <Text accessibilityRole="alert" style={styles.note}>{error}</Text>}
    {controls === undefined && (final && snapshot.table?.requires_replacement ? <Text style={styles.note}>Keep your seat for the next match, or choose Leave Seat above. The host can prepare the next match when every seat is filled.</Text> : (final || snapshot.round_review?.can_continue) ? <Pressable accessibilityRole="button" disabled={busy} onPress={final ? onNewGame : onContinue}
      style={[styles.button, busy && { opacity: 0.5 }]}><ActionCue active={!busy} style={styles.name}>{final ? 'Start a new game' : 'Start next deal'}</ActionCue></Pressable>
      : <Text style={styles.note}>Waiting for the creator to start the next deal.</Text>)}
    {!hideNavigation && <Pressable accessibilityRole="button" onPress={onBack} style={styles.back}><Text style={styles.note}>Back to room</Text></Pressable>}
  </ScrollView>;
}
const createStyles = (colors: ThemeColors) => StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background }, body: { padding: 20, gap: 16 },
  title: { ...gameHeadingFinish(colors), fontFamily: fonts.display, fontSize: 32, color: colors.text }, name: { fontFamily: fonts.medium, color: colors.text, fontSize: 15 },
  note: { fontFamily: fonts.body, color: colors.accent, fontSize: 13, lineHeight: 22 },
  row: { padding: 14, borderRadius: 10, backgroundColor: colors.surface, gap: 6 },
  button: { ...gameControlFinish(colors), minHeight: 48, padding: 14, borderRadius: 8, backgroundColor: colors.surfaceSelected, alignItems: 'center' }, back: { ...gameControlFinish(colors), minHeight: 44, justifyContent: 'center' },
});
