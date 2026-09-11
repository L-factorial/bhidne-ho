import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { RoomSnapshot } from '../screens/LiveGameTable';
import { colors, fonts } from '../theme';

export function LiveBidPrompt({ snapshot, busy, onAction }: {
  snapshot: RoomSnapshot; busy: boolean; onAction: (command: string, payload: object) => void;
}) {
  const [amount, setAmount] = useState(1);
  const maximum = snapshot.rules?.bid_max || 13;
  const isTurn = !!snapshot.your_player_id && snapshot.game?.turn.player_id === snapshot.your_player_id;
  const ownBid = snapshot.deal?.players.find(p => p.player_id === snapshot.your_player_id)?.bid;
  return <View style={styles.panel}>
    <Text accessibilityRole="alert" accessibilityLiveRegion="assertive" style={styles.title}>
      Deal {snapshot.deal?.deal_number} · {isTurn ? 'Your turn to bid' : 'Bidding is open'}
    </Text>
    <Text style={styles.text}>{isTurn ? 'Review your cards below. How many tricks will you win?' :
      ownBid != null ? `Your bid: ${ownBid}. Waiting for the remaining bids.` : `Player ${snapshot.game?.turn.player_id} is bidding${snapshot.your_player_id ? ' · your turn is coming' : ''}.`}</Text>
    {isTurn && <View style={styles.controls}>
      <Pressable accessibilityRole="button" accessibilityLabel="Decrease bid" disabled={busy || amount <= 1} onPress={() => setAmount(value => Math.max(1, value - 1))} style={styles.button}><Text style={styles.label}>−</Text></Pressable>
      <Text accessibilityLabel={`Selected bid ${amount}`} style={styles.amount}>{amount}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Increase bid" disabled={busy || amount >= maximum} onPress={() => setAmount(value => Math.min(maximum, value + 1))} style={styles.button}><Text style={styles.label}>+</Text></Pressable>
      <Pressable accessibilityRole="button" disabled={busy} onPress={() => onAction('PLACE_BID', { amount })} style={styles.button}><Text style={styles.label}>{busy ? 'Submitting…' : 'Confirm bid'}</Text></Pressable>
      <Text style={styles.text}>{snapshot.play_mode === 'manual' ? 'Your bid is submitted only when you confirm.' : `Auto bid in ${Math.ceil((snapshot.remaining_ms || 0) / 1000)}s`}</Text>
    </View>}
  </View>;
}
const styles = StyleSheet.create({
  panel: { padding: 12, marginVertical: 8, borderRadius: 12, borderWidth: 1, borderColor: '#8EDBFF', backgroundColor: '#173E58', gap: 4 },
  title: { color: '#8EDBFF', fontFamily: fonts.medium, fontSize: 15 }, text: { color: colors.ivory, fontFamily: fonts.body, fontSize: 12, lineHeight: 19 },
  controls: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10, marginTop: 6 },
  button: { minWidth: 44, minHeight: 44, padding: 10, borderRadius: 8, backgroundColor: colors.copper, alignItems: 'center', justifyContent: 'center' }, label: { color: colors.ivory, fontFamily: fonts.medium, fontSize: 12 }, amount: { color: colors.ivory, fontSize: 24, minWidth: 28, textAlign: 'center' },
});
