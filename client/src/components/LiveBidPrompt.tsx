import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { RoomSnapshot } from '../screens/LiveGameTable';
import { fonts, useThemedStyles, type ThemeColors } from '../theme';

export function LiveBidPrompt({ snapshot, busy, onAction, revealed }: {
  revealed: boolean; snapshot: RoomSnapshot; busy: boolean; onAction: (command: string, payload: object) => void;
}) {
  const styles = useThemedStyles(createStyles);
  const [amount, setAmount] = useState(1);
  const maximum = snapshot.rules?.bid_max || 13;
  const isTurn = !!snapshot.your_player_id && snapshot.game?.turn.player_id === snapshot.your_player_id;
  const ownBid = snapshot.deal?.players.find(p => p.player_id === snapshot.your_player_id)?.bid;
  const bidder = snapshot.players?.find(p => p.player_id === snapshot.game?.turn.player_id)?.display_name || `Player ${snapshot.game?.turn.player_id}`;
  return <View style={styles.panel}>
    <Text accessibilityRole="header" accessibilityLiveRegion="polite" style={styles.title}>
      {isTurn ? (revealed ? 'Make your call' : 'Reveal your hand') : 'Bidding'}
    </Text>
    <Text accessibilityLiveRegion="polite" style={styles.text}>{isTurn
      ? (revealed ? 'How many tricks will you win?' : 'Flip all cards or reveal them one at a time before choosing your bid.')
      : `${ownBid != null ? `Your bid: ${ownBid}. ` : ''}Waiting for ${bidder} to bid.`}</Text>
    {isTurn && revealed && <View style={styles.controls}>
      <Pressable accessibilityRole="button" accessibilityLabel="Decrease bid" disabled={busy || amount <= 1} onPress={() => setAmount(value => Math.max(1, value - 1))} style={styles.button}><Text style={styles.label}>−</Text></Pressable>
      <Text accessibilityLabel={`Selected bid ${amount}`} style={styles.amount}>{amount}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Increase bid" disabled={busy || amount >= maximum} onPress={() => setAmount(value => Math.min(maximum, value + 1))} style={styles.button}><Text style={styles.label}>+</Text></Pressable>
      <Pressable accessibilityRole="button" disabled={busy} onPress={() => onAction('PLACE_BID', { amount })} style={styles.button}><Text style={styles.label}>{busy ? 'Submitting…' : 'Confirm bid'}</Text></Pressable>
      <Text style={styles.text}>Your bid is submitted only when you confirm.</Text>
    </View>}
  </View>;
}
const createStyles = (colors: ThemeColors) => StyleSheet.create({
  panel: { padding: 12, marginVertical: 8, borderRadius: 12, borderWidth: 1, borderColor: colors.accent, backgroundColor: colors.surface, gap: 4 },
  title: { color: colors.accent, fontFamily: fonts.medium, fontSize: 15 }, text: { color: colors.text, fontFamily: fonts.body, fontSize: 12, lineHeight: 19 },
  controls: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10, marginTop: 6 },
  button: { minWidth: 44, minHeight: 44, padding: 10, borderRadius: 8, backgroundColor: colors.surfaceSelected, alignItems: 'center', justifyContent: 'center' }, label: { color: colors.text, fontFamily: fonts.medium, fontSize: 12 }, amount: { color: colors.accent, backgroundColor: colors.surfaceSelected, borderWidth: 2, borderColor: colors.accent, borderRadius: 8, padding: 8, fontSize: 24, minWidth: 48, textAlign: 'center' },
});
