import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { RoomSnapshot } from '../screens/LiveGameTable';
import type { MarriageScoringRules } from '../multiplayer/marriage';
import { fonts, useThemedStyles, type ThemeColors } from '../theme';

const tables = ['tiplu', 'jhiplu', 'poplu', 'man', 'marriage'] as const;
const amounts = ['tunnela_bonus', 'seen_payment', 'unseen_payment', 'dublee_win_bonus'] as const;
const labels = { tiplu: 'Tiplu', jhiplu: 'Jhiplu', poplu: 'Poplu', man: 'Man', marriage: 'Marriage combination',
  tunnela_bonus: 'Extra points per Tunnela', seen_payment: 'Loser payment: Maal seen', unseen_payment: 'Loser payment: Maal unseen', dublee_win_bonus: 'Extra per loser: Dublee win' };

export function MarriageScoring({ snapshot, busy, error, onSave }: {
  snapshot: RoomSnapshot; busy: boolean; error: string; onSave: (rules: MarriageScoringRules) => void;
}) {
  const s = useThemedStyles(createStyles);
  const saved = snapshot.marriage?.public.scoring_rules || snapshot.marriage_scoring;
  const [draft, setDraft] = useState(saved);
  const savedKey = JSON.stringify(saved);
  useEffect(() => setDraft(saved), [savedKey]);
  const editable = snapshot.status === 'waiting' && !!snapshot.is_creator;
  if (!draft) return <Text style={s.text}>Scoring rules are loading.</Text>;
  const valid = [...tables.flatMap(key => draft[key]), ...amounts.map(key => draft[key])].every(n => Number.isInteger(n) && n >= 0 && n <= 1000);
  const changed = JSON.stringify(draft) !== savedKey;
  function button(label: string, onPress: () => void, selected = false, disabled = false) {
    return <Pressable accessibilityRole="button" accessibilityState={{ selected, disabled }} disabled={disabled || busy} onPress={onPress}
      style={[s.button, selected && s.selected, (disabled || busy) && { opacity: 0.5 }]}><Text style={s.text}>{label}</Text></Pressable>;
  }
  function input(label: string, value: number, update: (n: number) => void) {
    return editable ? <TextInput accessibilityLabel={label} keyboardType="number-pad" value={Number.isNaN(value) ? '' : String(value)}
      editable={!busy} maxLength={4} onChangeText={text => update(/^\d+$/.test(text) ? Number(text) : NaN)} style={s.input} />
      : <Text style={[s.text, s.value]}>{value}</Text>;
  }
  return <View testID="marriage-scoring-rules" style={s.section}>
    <Text style={s.heading}>Scoring rules</Text>
    <Text style={s.text}>{editable ? 'House bonus is the default. Choose a preset or edit any value, then save before starting.' : 'The creator selects these rules before the round. They are locked during play.'}</Text>
    {editable && <View style={s.row}>{Object.entries(snapshot.marriage_scoring_presets || {}).map(([key, rules]) =>
      <View key={key}>{button(key === 'house' ? 'House bonus (default)' : 'Simple points', () => setDraft(rules), JSON.stringify(draft) === JSON.stringify(rules))}</View>)}</View>}
    <Text style={s.text}>Totals for 1 / 2 / 3 copies or combinations</Text>
    {tables.map(key => <View key={key} style={s.row}><Text style={[s.text, s.label]}>{labels[key]}</Text>
      {draft[key].map((value, i) => <View key={i}>{input(`${labels[key]} ${i + 1} total`, value, n => setDraft({ ...draft, [key]: draft[key].map((v, j) => i === j ? n : v) }))}</View>)}
    </View>)}
    {amounts.map(key => <View key={key} style={s.row}><Text style={[s.text, s.label]}>{labels[key]}</Text>
      {input(labels[key], draft[key], n => setDraft({ ...draft, [key]: n }))}</View>)}
    <Text style={s.text}>Tunnela bonus applies to</Text>
    <View style={s.row}>{(['off', 'shown', 'hand'] as const).map(scope => <View key={scope}>{editable
      ? button(scope === 'off' ? 'None' : scope === 'shown' ? 'Shown Tunnelas' : 'All final Tunnelas', () => setDraft({ ...draft, tunnela_scope: scope }), draft.tunnela_scope === scope)
      : draft.tunnela_scope === scope && <Text style={s.text}>{scope === 'off' ? 'None' : scope === 'shown' ? 'Shown Tunnelas' : 'All final Tunnelas'}</Text>}</View>)}</View>
    {editable ? button(draft.maal_requires_seen ? 'Maal points: seen players only' : 'Maal points: all players', () => setDraft({ ...draft, maal_requires_seen: !draft.maal_requires_seen }))
      : <Text style={s.text}>Maal points: {draft.maal_requires_seen ? 'seen players only' : 'all players'}</Text>}
    <Text style={s.text}>The highest scoring combination is used. Marriage replaces its individual Maal points. The Tunnela bonus is additional; it uses shown groups or final holdings, not a declaration at deal time. Eligibility also applies to Man and Tunnela points.</Text>
    {editable && <>{button('Save scoring rules', () => onSave(draft), false, !valid || !changed)}
      <Text style={s.text}>{!valid ? 'Enter whole numbers from 0 to 1000.' : changed ? 'Unsaved changes' : 'Saved rules apply when the game starts.'}</Text></>}
    {!!error && <Text accessibilityRole="alert" style={s.text}>{error}</Text>}
  </View>;
}

export function MarriagePoints({ snapshot }: { snapshot: RoomSnapshot }) {
  const s = useThemedStyles(createStyles);
  const scores = snapshot.marriage?.public.scores;
  const name = (id: string) => snapshot.players?.find(p => String(p.player_id) === id)?.display_name || `Player ${id}`;
  const signed = (n: number) => n > 0 ? `+${n}` : String(n);
  return <View testID="marriage-points" style={s.section}>
    {!scores ? <Text style={s.text}>{snapshot.status === 'ended' ? 'The game was ended without a winner. No final points were calculated.'
      : snapshot.status === 'finished' ? 'This round has no scoring breakdown available.' : 'Points appear here when the round finishes, using the saved scoring rules.'}</Text> : <>
      <Text style={s.heading}>Winner: {name(scores.winner)}</Text>
      <Text style={s.text}>Total Maal: {scores.total_maal}. Positive points are won; negative points are paid.</Text>
      <Text style={s.text}>Maal net = players x own Maal - total Maal. Net points = Maal net + winner payment. All net points sum to zero.</Text>
      <Text style={s.text}>Each loser pays {scores.rules.seen_payment} if Maal seen, otherwise {scores.rules.unseen_payment}, plus {scores.rules.dublee_win_bonus} for a Dublee winner.</Text>
      {scores.players.map(p => <View key={p.player_id} style={s.player}>
        <Text style={s.heading}>{name(p.player_id)}: {signed(p.net_points)} points</Text>
        <Text style={s.text}>{p.has_seen_maal ? 'Maal seen' : 'Maal not seen'}{p.eligible ? '' : ' / not eligible for Maal points'}</Text>
        {p.items.map((item, i) => <Text key={i} style={s.text}>{item.label} x {item.count}: {item.points}</Text>)}
        <Text style={s.text}>Own Maal: {p.maal_points}</Text>
        <Text style={s.text}>Maal net: {scores.players.length} x {p.maal_points} - {scores.total_maal} = {signed(p.maal_net)}</Text>
        <Text style={s.text}>Winner payment: {signed(p.winner_payment)}</Text>
        <Text style={s.text}>Net: {signed(p.maal_net)} + ({signed(p.winner_payment)}) = {signed(p.net_points)}</Text>
      </View>)}
    </>}
  </View>;
}
const createStyles = (colors: ThemeColors) => StyleSheet.create({
  section: { gap: 12 }, row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  label: { flexGrow: 1, flexBasis: 120 }, value: { width: 44, textAlign: 'center' },
  text: { color: colors.text, fontFamily: fonts.body, fontSize: 13, lineHeight: 21 },
  heading: { color: colors.accent, fontFamily: fonts.medium, fontSize: 16 },
  input: { width: 46, minHeight: 44, color: colors.text, backgroundColor: colors.surfaceRaised, borderRadius: 6, textAlign: 'center' },
  button: { padding: 10, minHeight: 44, borderWidth: 1, borderColor: colors.border, borderRadius: 8 }, selected: { backgroundColor: colors.successSurface },
  player: { gap: 5, paddingVertical: 12, borderTopWidth: 1, borderColor: colors.border },
});
