import { ui } from '../i18n/copy.ts';
import { useUiLanguage } from '../i18n/useUiLanguage';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { RoomSnapshot } from '../screens/LiveGameTable';
import { fonts, gameButtonStyle, useTheme, useThemedStyles, type ThemeColors } from '../theme';
import { ActionCue } from './ActionCue';

export function LiveBidPrompt({ snapshot, busy, onAction, revealed }: {
  revealed: boolean; snapshot: RoomSnapshot; busy: boolean; onAction: (command: string, payload: object) => void;
}) {
  useUiLanguage();
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const [amount, setAmount] = useState(1);
  const maximum = snapshot.rules?.bid_max || 13;
  const isTurn = !!snapshot.your_player_id && snapshot.game?.turn.player_id === snapshot.your_player_id;
  const ownBid = snapshot.deal?.players.find(p => p.player_id === snapshot.your_player_id)?.bid;
  const bidder = snapshot.players?.find(p => p.player_id === snapshot.game?.turn.player_id)?.display_name || ui("common.player_number", { "number": snapshot.game?.turn.player_id });
  return <View style={styles.panel}>
    <Text accessibilityRole="header" accessibilityLiveRegion="polite" style={styles.title}>
      {isTurn ? (revealed ? ui("callbreak.make_your_call") : ui("common.reveal_your_hand")) : ui("callbreak.bidding")}
    </Text>
    <Text accessibilityLiveRegion="polite" style={styles.text}>{isTurn
      ? (revealed ? ui("callbreak.how_many_tricks_will_you_win") : 'Flip all cards or reveal them one at a time before choosing your bid.')
      : `${ownBid != null ? ui("callbreak.your_bid_count", { "count": ownBid }) : ''}Waiting for ${bidder} to bid.`}</Text>
    {isTurn && revealed && <View style={styles.controls}>
      <Pressable accessibilityRole="button" accessibilityLabel={ui("callbreak.decrease_bid")} disabled={busy || amount <= 1} onPress={() => setAmount(value => Math.max(1, value - 1))} style={styles.button}><Text style={styles.label}>−</Text></Pressable>
      <Text accessibilityLabel={ui("callbreak.selected_bid_count", { "count": amount })} style={styles.amount}>{amount}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={ui("callbreak.increase_bid")} disabled={busy || amount >= maximum} onPress={() => setAmount(value => Math.min(maximum, value + 1))} style={styles.button}><Text style={styles.label}>+</Text></Pressable>
      <Pressable accessibilityRole="button" disabled={busy} onPress={() => onAction('PLACE_BID', { amount })} style={({ pressed }) => [styles.button, gameButtonStyle(colors, 'primary', pressed)]}><ActionCue active={!busy} style={[styles.label, { color: colors.onPrimary }]}>{busy ? 'Submitting…' : ui("callbreak.confirm_bid")}</ActionCue></Pressable>
      <Text style={styles.text}>{ui("common.your_bid_is_submitted_only_when_you_confirm")}</Text>
    </View>}
  </View>;
}
const createStyles = (colors: ThemeColors) => StyleSheet.create({
  panel: { padding: 12, marginVertical: 8, borderRadius: 12, borderWidth: 1, borderColor: colors.accent, backgroundColor: colors.surface, gap: 4 },
  title: { color: colors.accent, fontFamily: fonts.medium, fontSize: 15 }, text: { color: colors.text, fontFamily: fonts.body, fontSize: 12, lineHeight: 19 },
  controls: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10, marginTop: 6 },
  button: { padding: 10, ...gameButtonStyle(colors), alignItems: 'center', justifyContent: 'center' }, label: { color: colors.onTableHeader, fontFamily: fonts.medium, fontSize: 12 }, amount: { color: colors.accent, backgroundColor: colors.surfaceSelected, borderWidth: 2, borderColor: colors.accent, borderRadius: 8, padding: 8, fontSize: 24, minWidth: 48, textAlign: 'center' },
});
