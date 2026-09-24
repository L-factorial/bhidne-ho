import { ui } from '../i18n/copy.ts';
import { useUiLanguage } from '../i18n/useUiLanguage';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { fonts, useThemedStyles, type ThemeColors } from '../theme';
import type { RoomSnapshot } from '../screens/LiveGameTable';

export function FlushBetTable({ snapshot }: { snapshot: RoomSnapshot }) {
  useUiLanguage();
  const s = useThemedStyles(styles), pub = snapshot.flush?.public;
  if (!pub) return <Text style={s.cell}>{ui("flush.bets_appear_after_the_game_starts")}</Text>;
  const results = pub.round_results;
  const signed = (amount: number) => amount > 0 ? `+${amount}` : String(amount);
  return <View>
    {!results.length && <Text style={s.cell}>{ui("flush.results_appear_after_the_first_round")}</Text>}
    <ScrollView horizontal testID="flush-bet-grid"><View>
      <View style={s.row}>{[ui("common.player"), ...results.map(r => ui("flush.round_number", { "number": r.round_number })), ui("flush.total")].map(h => <Text key={h} style={[s.cell, s.header]}>{h}</Text>)}</View>
      {(snapshot.flush?.participants || pub.players).map(p => {
        const amounts = results.map(r => r.net_changes.find(change => change.player_id === p.player_id)?.amount ?? 0);
        const name = snapshot.flush?.participants?.find(row => row.player_id === p.player_id)?.display_name || snapshot.players?.find(row => String(row.player_id) === p.player_id)?.display_name || ui("common.player_number", { "number": p.player_id });
        return <View key={p.player_id} style={s.row}>
          <Text style={s.cell}>{name}</Text>
          {[...amounts, amounts.reduce((sum, amount) => sum + amount, 0)].map((amount, i) => <Text key={i} style={s.cell}>{signed(amount)}</Text>)}
        </View>;
      })}
    </View></ScrollView>
  </View>;
}
const styles = (c: ThemeColors) => StyleSheet.create({
  row: { flexDirection: 'row' }, cell: { width: 96, padding: 10, color: c.text, borderBottomWidth: 1, borderColor: c.border, fontFamily: fonts.body, fontSize: 13 },
  header: { backgroundColor: c.surfaceSelected, fontFamily: fonts.medium },
});
