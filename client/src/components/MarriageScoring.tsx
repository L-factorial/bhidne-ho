import { MarriageMeldCards } from './MarriageMeldCards';
import { PlayerAvatar } from './PlayerAvatar';
import { gameControlFinish, gameHeadingFinish, fonts, useThemedStyles, type ThemeColors } from '../theme';
import { RoundResultsTable } from './RoundResultsTable';
import { FormScrollView } from './FormInput';
import { type ReactNode } from 'react';
import { FormFooter } from './FormFooter';
import { NumericInput } from './NumericInput';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { RoomSnapshot } from '../screens/LiveGameTable';
import type { MarriageScoringRules } from '../multiplayer/marriage';

const tables = ['tiplu', 'jhiplu', 'poplu', 'alter', 'man', 'marriage'] as const;
const amounts = ['tunnela_bonus', 'seen_payment', 'unseen_payment', 'dublee_win_bonus'] as const;
const labels = { tiplu: 'Tiplu', jhiplu: 'Jhiplu', poplu: 'Poplu', alter: 'Alter', man: 'Man', marriage: 'Marriage combination',
  tunnela_bonus: 'Extra points per Tunnela', seen_payment: 'Loser payment: Maal seen', unseen_payment: 'Loser payment: Maal unseen', dublee_win_bonus: 'Extra per loser: Dublee win' };

export function MarriageScoring({ snapshot, busy, error, onSave, introduction }: {
  introduction?: ReactNode; snapshot: RoomSnapshot; busy: boolean; error: string; onSave: (rules: MarriageScoringRules) => void;
}) {
  const s = useThemedStyles(createStyles);
  const source = snapshot.marriage?.public.scoring_rules || snapshot.marriage_scoring;
  const saved = source ? {...source, alter:source.alter || [0,0,0],initial_tunnela_declaration:source.initial_tunnela_declaration ?? false} : undefined;
  const [draft, setDraft] = useState(saved);
  const savedKey = JSON.stringify(saved);
  useEffect(() => setDraft(saved), [savedKey, snapshot.rule_proposal?.id, snapshot.rule_proposal?.status]);
  const editable = snapshot.status === 'waiting' && !!snapshot.is_creator && snapshot.rule_proposal?.status !== 'PENDING';
  if (!draft) return <Text style={s.text}>Scoring rules are loading.</Text>;
  const valid = [...tables.flatMap(key => draft[key]), ...amounts.map(key => draft[key])].every(n => Number.isInteger(n) && n >= 0 && n <= 1000);
  const changed = JSON.stringify(draft) !== savedKey;
  function button(label: string, onPress: () => void, selected = false, disabled = false) {
    return <Pressable accessibilityRole="button" accessibilityState={{ selected, disabled }} disabled={disabled || busy} onPress={onPress}
      style={[s.button, selected && s.selected, (disabled || busy) && { opacity: 0.5 }]}><Text style={s.text}>{label}</Text></Pressable>;
  }
  function input(label: string, value: number, update: (n: number) => void) {
    return editable ? <NumericInput accessibilityLabel={label} keyboardType="number-pad" value={Number.isNaN(value) ? '' : String(value)}
      editable={!busy} maxLength={4} onChangeText={text => update(/^\d+$/.test(text) ? Number(text) : NaN)} style={s.input} />
      : <Text style={[s.text, s.value]}>{value}</Text>;
  }
  return <View testID="marriage-scoring-rules" style={{ flex: 1, minHeight: 0 }}><FormScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 20, gap: 12 }}>{introduction}
    <Text style={s.heading}>Scoring rules</Text>
    <Text style={s.text}>{editable ? 'House bonus is the default. Choose a preset or edit any value, then propose the change for player approval.' : 'The creator selects these rules before the round. They are locked during play.'}</Text>
    {editable && <View style={s.row}>{Object.entries(snapshot.marriage_scoring_presets || {}).map(([key, rules]) =>
      <View key={key}>{button(key === 'house' ? 'House bonus (default)' : 'Simple points', () => setDraft({...rules,alter:rules.alter || [0,0,0],initial_tunnela_declaration:rules.initial_tunnela_declaration ?? false}), JSON.stringify(draft) === JSON.stringify(rules))}</View>)}</View>}
    <Text style={s.text}>Totals for 1 / 2 / 3 copies or combinations</Text>
    {tables.map(key => <View key={key} style={s.row}><Text style={[s.text, s.label]}>{labels[key]}</Text>
      {draft[key].map((value, i) => <View key={i}>{input(`${labels[key]} ${i + 1} total`, value, n => setDraft({ ...draft, [key]: draft[key].map((v, j) => i === j ? n : v) }))}</View>)}
    </View>)}
    <Text style={s.text}>Alter is the same rank and colour as Tiplu, in the other suit. Its default totals are 1 / 2 / 3; set all three to 0 to disable Alter points. Wildcard use is unchanged.</Text>
    {amounts.map(key => <View key={key} style={s.row}><Text style={[s.text, s.label]}>{labels[key]}</Text>
      {input(labels[key], draft[key], n => setDraft({ ...draft, [key]: n }))}</View>)}
    {button(`Initial Tunnela declaration: ${draft.initial_tunnela_declaration?'On':'Off'}`,()=>setDraft({...draft,initial_tunnela_declaration:!draft.initial_tunnela_declaration,tunnela_scope:!draft.initial_tunnela_declaration && draft.tunnela_scope === 'hand' ? 'shown' : draft.tunnela_scope}),!!draft.initial_tunnela_declaration,!editable)}
    <Text style={s.text}>{draft.initial_tunnela_declaration?'Before the first draw, every player must show dealt Tunnelas or declare none. Only those initial declarations earn the Tunnela bonus.':'Tunnela bonus applies to'}</Text>
    <View style={s.row}>{(draft.initial_tunnela_declaration ? ['off','shown'] as const : ['off', 'shown', 'hand'] as const).map(scope => <View key={scope}>{editable
      ? button(scope === 'off' ? 'None' : scope === 'shown' ? draft.initial_tunnela_declaration?'Initially declared Tunnelas':'Shown Tunnelas' : 'All final Tunnelas', () => setDraft({ ...draft, tunnela_scope: scope }), draft.tunnela_scope === scope)
      : draft.tunnela_scope === scope && <Text style={s.text}>{scope === 'off' ? 'None' : scope === 'shown' ? draft.initial_tunnela_declaration?'Initially declared Tunnelas':'Shown Tunnelas' : 'All final Tunnelas'}</Text>}</View>)}</View>
    {editable ? button(draft.maal_requires_seen ? 'Maal points: seen players only' : 'Maal points: all players', () => setDraft({ ...draft, maal_requires_seen: !draft.maal_requires_seen }))
      : <Text style={s.text}>Maal points: {draft.maal_requires_seen ? 'seen players only' : 'all players'}</Text>}
    <Text style={s.text}>The highest scoring combination is used. Marriage replaces its individual Maal points. The Tunnela bonus is additional and follows the declaration setting above. Eligibility also applies to Man and Tunnela points.</Text>
    </FormScrollView><FormFooter>
    {editable && <>{button('Propose scoring rules', () => onSave(draft), false, !valid || !changed)}
      <Text style={s.text}>{!valid ? 'Enter whole numbers from 0 to 1000.' : changed ? 'Unsaved changes' : 'Rule changes apply only after every seated player accepts.'}</Text></>}
    {!!error && <Text accessibilityRole="alert" style={s.text}>{error}</Text>}
    </FormFooter></View>;
}

export function MarriageRoundResults({ snapshot }: { snapshot: RoomSnapshot }) {
  const scores = snapshot.marriage?.public.scores;
  if (!scores) return null;
  const name = (id: string) => snapshot.players?.find(p => String(p.player_id) === id)?.display_name || `Player ${id}`;
  const signed = (n: number) => n > 0 ? `+${n}` : String(n);
  return <RoundResultsTable subtitle={`Winner: ${name(scores.winner)}`} columns={['Maal', 'Payment', 'Net']} rows={scores.players.map(p => ({
    id: p.player_id, name: name(p.player_id), avatarUrl: snapshot.players?.find(player => String(player.player_id) === p.player_id)?.avatar_url,
    own: p.player_id === String(snapshot.your_player_id), winner: p.player_id === scores.winner,
    values: [{ text: String(p.maal_points) }, { text: signed(p.winner_payment), amount: p.winner_payment }, { text: signed(p.net_points), amount: p.net_points }],
  }))} />;
}

export function MarriagePoints({ snapshot }: { snapshot: RoomSnapshot }) {
  const s = useThemedStyles(createStyles);
  const scores = snapshot.marriage?.public.scores;
  const name = (id: string) => snapshot.players?.find(p => String(p.player_id) === id)?.display_name || `Player ${id}`;
  const signed = (n: number) => n > 0 ? `+${n}` : String(n);
  return <View testID="marriage-points" style={s.section}>
    {!scores ? <Text style={s.text}>{snapshot.status === 'ended' ? 'The game was ended without a winner. No final points were calculated.'
      : snapshot.status === 'finished' ? 'This round has no scoring breakdown available.' : 'Points appear here when the round finishes, using the saved scoring rules.'}</Text> : <>
      <MarriageRoundResults snapshot={snapshot} />
      <Text accessibilityRole="header" style={s.heading}>How the points were calculated</Text>
      <Text style={s.text}>Total Maal: {scores.total_maal}. Positive points are won; negative points are paid.</Text>
      <Text style={s.text}>Maal net = players x own Maal - total Maal. Net points = Maal net + winner payment. All net points sum to zero.</Text>
      <Text style={s.text}>Each loser pays {scores.rules.seen_payment} if Maal seen, otherwise {scores.rules.unseen_payment}, plus {snapshot.marriage?.public.won_by_fold ? 0 : scores.rules.dublee_win_bonus} for a completed Dublee win.</Text>
      {scores.players.map(p => <View key={p.player_id} style={s.player}>
        <View style={s.row}><PlayerAvatar uri={snapshot.players?.find(player => String(player.player_id) === p.player_id)?.avatar_url} />
          <Text style={s.heading}>{name(p.player_id)}: {signed(p.net_points)} points</Text></View>
        <Text style={s.text}>{p.has_seen_maal ? 'Maal seen' : 'Maal not seen'}{p.eligible ? '' : ' / not eligible for Maal points'}</Text>
        {!p.items.length && <Text style={s.text}>{p.eligible ? 'No scoring cards.' : 'Maal points are not counted because Maal was not seen.'}</Text>}
        {p.items.map((item, i) => <View key={i} style={{ gap: 6 }}>
          <Text style={s.text}>{item.label} × {item.count}: {item.points} points</Text>
          {!!item.card_ids?.length && <MarriageMeldCards groups={[{ meld_type: 'set', card_ids: item.card_ids }]} hideLabels />}
          {item.label === 'Tunnela bonus' && <Text style={s.text}>Additional bonus: {item.count} × {scores.rules.tunnela_bonus} = {item.points}. These cards can also earn Maal points.</Text>}
        </View>)}
        <Text style={s.text}>Own Maal: {p.maal_points}</Text>
        <Text style={s.text}>Maal net: {scores.players.length} x {p.maal_points} - {scores.total_maal} = {signed(p.maal_net)}</Text>
        <Text style={s.text}>Winner payment: {signed(p.winner_payment)}</Text>
        <Text style={s.text}>Net: {signed(p.maal_net)} + ({signed(p.winner_payment)}) = {signed(p.net_points)}</Text>
      </View>)}
      {snapshot.marriage?.public.won_by_fold ? <Text style={s.text}>Won by fold · all other players withdrew. No winning declaration was required.</Text> : <>
      <Text accessibilityRole="header" style={s.heading}>Winning declaration</Text>
      <MarriageMeldCards groups={snapshot.marriage?.public.normal_finish?.melds || [
        ...(snapshot.marriage?.public.players.find(p => p.player_id === scores.winner)?.shown_melds || []),
        ...(snapshot.marriage?.public.winning_pair?.length ? [{ meld_type: 'dublee' as const, card_ids: snapshot.marriage.public.winning_pair }] : []),
      ]} />
      {!!snapshot.marriage?.public.normal_finish && <><Text style={s.text}>Final discard · excluded from scoring</Text>
        <MarriageMeldCards groups={[{ meld_type: 'set', card_ids: [snapshot.marriage.public.normal_finish.discard_card_id] }]} hideLabels /></>}
      </>}
    </>}
  </View>;
}
const createStyles = (colors: ThemeColors) => StyleSheet.create({
  section: { gap: 12 }, row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  label: { flexGrow: 1, flexBasis: 120 }, value: { width: 44, textAlign: 'center' },
  text: { color: colors.text, fontFamily: fonts.body, fontSize: 13, lineHeight: 21 },
  heading: { ...gameHeadingFinish(colors), color: colors.accent, fontFamily: fonts.medium, fontSize: 16 },
  input: { width: 46, minHeight: 44, color: colors.text, backgroundColor: colors.surfaceRaised, borderRadius: 6, textAlign: 'center' },
  button: { ...gameControlFinish(colors), padding: 10, minHeight: 44, borderWidth: 1, borderColor: colors.border, borderRadius: 8 }, selected: { backgroundColor: colors.successSurface },
  player: { gap: 5, paddingVertical: 12, borderTopWidth: 1, borderColor: colors.border },
});
