import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { colors, fonts } from '../theme';
import { TurnPulse } from '../components/TurnPulse';
import { PokeComposer } from '../components/PokeComposer';
import type { PlayerPhrase } from '../multiplayer/pokes';
import type { RoomSnapshot } from './LiveGameTable';
import { canSubmitMarriage, marriageSuggestions, marriageUsesArc, marriageFace, physicalLabel, suitName, type MarriageMeld } from '../multiplayer/marriage';

export function MarriageTable({ snapshot, busy, error, onAction, onStart, onBack, onNewGame, endControl, social }: {
  snapshot: RoomSnapshot; busy: boolean; error: string; endControl?: ReactNode;
  onAction: (command: string, payload?: object) => void; onStart: (mode: 'auto' | 'manual') => void; onBack: () => void; onNewGame: () => void;
  social: { connected: boolean; phrases: PlayerPhrase[]; save: (text: string) => Promise<void>; send: (recipient: number | null, text: string) => Promise<void> };
}) {
  const wide = useWindowDimensions().width >= 1000;
  const [playMode, setPlayMode] = useState<'auto' | 'manual'>('auto');
  const [width, setWidth] = useState(300);
  const [mode, setMode] = useState<'grid' | 'fan' | 'suits'>('grid');
  const [suit, setSuit] = useState('all');
  const [revealed, setRevealed] = useState(0);
  const [hidden, setHidden] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [groups, setGroups] = useState<MarriageMeld[]>([]);
  const [kind, setKind] = useState<MarriageMeld['meld_type']>('dublee');
  const [details, setDetails] = useState<'players' | 'rules'>('players');
  const [poke, setPoke] = useState<number | null | undefined>(undefined);
  const pub = snapshot.marriage?.public, mine = snapshot.marriage?.private;
  const hand = mine?.hand || [], actions = mine?.actions;
  const own = pub?.players.find(p => p.player_id === mine?.player_id);
  const committed = own?.shown_melds.flatMap(m => m.card_ids) || [];
  const handKey = hand.map(c => c.card_id).join(',') + committed.join(',');
  useEffect(() => {
    const available = hand.filter(c => !committed.includes(c.card_id)).map(c => c.card_id);
    setSelected(current => current.filter(id => available.includes(id)));
    setGroups(current => current.filter(g => g.card_ids.every(id => available.includes(id))));
  }, [handKey]);
  const allRevealed = revealed >= 21;
  const availableHand = hand.filter(c => !committed.includes(c.card_id));
  const suggestions = useMemo(() => allRevealed ? marriageSuggestions(availableHand) : null, [handKey, allRevealed]);
  const canAct = !busy && !hidden && allRevealed && snapshot.status === 'playing';
  const name = (id: string | null) => snapshot.players?.find(p => String(p.player_id) === id)?.display_name || `Player ${id}`;
  const isTurn = !!mine && mine.player_id === pub?.current_player_id;
  const staged = groups.flatMap(g => g.card_ids);
  const declaration = canSubmitMarriage(groups);
  const selectedMeld = { meld_type: kind, card_ids: selected };
  function button(label: string, action: () => void, disabled = false, chosen = false) {
    return <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled}
      accessibilityState={{ disabled, selected: chosen }} onPress={action} style={[s.button, chosen && s.chosen, disabled && s.disabled]}>
      <Text style={s.buttonText}>{label}</Text></Pressable>;
  }
  const shown = !allRevealed ? availableHand : [...availableHand].filter(c => mode !== 'suits' || suit === 'all' || (c.suit || 'man') === suit)
    .sort((a, b) => (a.suit || 'Z').localeCompare(b.suit || 'Z') || (a.rank || 0) - (b.rank || 0) || a.card_id.localeCompare(b.card_id));
  const fan = marriageUsesArc(availableHand.length, mode, !allRevealed);
  return <View style={s.page} testID="marriage-table">
    <View style={s.header}><Text accessibilityRole="header" style={s.title}>भिड्ने हो? · Marriage</Text>{endControl}{button('Collapse game', onBack)}</View>
    <ScrollView contentContainerStyle={s.content}>
      {!pub ? <View style={s.panel}>
        <Text style={s.heading}>{snapshot.players?.length}/{snapshot.capacity} players seated</Text>
        {snapshot.players?.map(p => <Text key={p.player_id} style={s.text}>{p.display_name || `Player ${p.player_id}`}{p.player_id === snapshot.your_player_id ? ' · You' : ''}</Text>)}
        <Text style={s.text}>Build seven pairs, see Maal, then finish with an eighth pair. Normal qualification is available; normal-hand winning and scoring come later.</Text>
        {snapshot.is_creator && <View style={s.row}>{button('Autoplay', () => setPlayMode('auto'), busy, playMode === 'auto')}{button('Player play', () => setPlayMode('manual'), busy, playMode === 'manual')}</View>}
        {snapshot.is_creator ? button('Start game', () => onStart(playMode), busy || !snapshot.ready) : <Text style={s.text}>Waiting for the creator to start.</Text>}
      </View> : <>
        {snapshot.status === 'finished' && <View style={s.panel}><Text accessibilityRole="header" style={s.heading}>{name(pub.winner)} wins!</Text>
          <Text style={s.text}>Eight Dublees complete. Ready for another round?</Text>{button('Start a new game', onNewGame)}</View>}
        <View style={[s.columns, wide && { flexDirection: 'row' }]}>
          <View style={s.main}>
            <View style={s.table}>
              {snapshot.play_mode === 'auto' && <Text style={s.small}>Test autoplay · moves every few seconds</Text>}
              <View style={s.seats}>{pub.players.map(p => <Pressable key={p.player_id} accessibilityRole="button" accessibilityLabel={`Poke ${name(p.player_id)}`}
                onPress={() => setPoke(Number(p.player_id))} disabled={!mine || p.player_id === mine.player_id}
                style={[s.seat, pub.current_player_id === p.player_id && s.activeSeat]}>
                <Text style={s.player}>{name(p.player_id)}{p.player_id === mine?.player_id ? ' · You' : ''}</Text>
                <Text style={s.text}>{p.hand_count} cards · {p.route === 'unqualified' ? 'Not shown' : p.route === 'dublee' ? 'Seven Dublees' : 'Melds shown'}</Text>
                <Text style={s.small}>{snapshot.players?.find(row => String(row.player_id) === p.player_id)?.connected === false ? 'Reconnecting' : p.has_seen_maal ? 'Maal unlocked' : 'Maal hidden'}</Text>
              </Pressable>)}</View>
              <View style={s.piles}>{button(`Take stock · ${pub.stock_count}`, () => onAction('DRAW_CARD', { source: 'stock' }), !canAct || !actions?.drawable_sources.includes('stock'))}
                <View style={{ alignItems: 'center', gap: 8 }}><Text style={s.pileFace}>{pub.top_discard ? marriageFace(pub.top_discard) : '—'}</Text>
                  {button('Take discard', () => onAction('DRAW_CARD', { source: 'discard' }), !canAct || !actions?.drawable_sources.includes('discard'))}</View></View>
              {snapshot.status === 'playing' && <TurnPulse personal={isTurn} text={isTurn ? `Your turn · ${pub.phase === 'must_draw' ? 'Take a card' : 'Show, finish, or discard'}` : `${name(pub.current_player_id)}’s turn`} />}
              {actions?.reason && <Text style={s.small}>{actions.reason}</Text>}
              {actions?.kinds.includes('finish') && button('Finish round', () => onAction('FINISH'), !canAct)}
              {mine && button('Poke the table', () => setPoke(null), !social.connected)}
            </View>
            {mine ? <View style={s.panel} onLayout={e => setWidth(Math.min(780, Math.max(120, e.nativeEvent.layout.width - 28)))}>
              <View style={s.row}><Text style={s.heading}>Your cards · {availableHand.length}</Text>{allRevealed && button(hidden ? 'Show cards' : 'Hide cards', () => { setHidden(v => !v); setSelected([]); })}</View>
              <View testID="marriage-hand" style={[s.hand, fan && { height: 126, maxWidth: width }]}>{shown.map((card, index) => {
                const back = hidden || (!allRevealed && index >= revealed);
                const locked = committed.includes(card.card_id) || staged.includes(card.card_id), checked = selected.includes(card.card_id);
                return <Pressable key={card.card_id} accessibilityRole="button" accessibilityLabel={back ? 'Reveal next card' : `${physicalLabel(card.card_id)}${locked ? ' grouped' : ''}`}
                  accessibilityState={{ selected: checked, disabled: busy || hidden || (allRevealed && locked) }} disabled={busy || hidden || (allRevealed && locked)}
                  onPress={() => !allRevealed ? setRevealed(n => Math.min(21, n + 1)) : setSelected(ids => checked ? ids.filter(id => id !== card.card_id) : [...ids, card.card_id])}
                  style={[s.card, back && s.cardBack, checked && s.selectedCard, locked && !back && { opacity: 0.55 }, fan && { position: 'absolute',
                    left: index * Math.max(0, (width - 60) / Math.max(1, shown.length - 1)), top: Math.abs(index - (shown.length - 1) / 2) * 1.5 + (checked ? 0 : 12),
                    transform: [{ rotate: `${(index - (shown.length - 1) / 2) * 1.5}deg` }] }]}>
                  <Text style={[s.face, { color: card.suit === 'H' || card.suit === 'D' ? '#B13639' : '#162A42' }]}>{back ? '✦' : marriageFace(card)}</Text>
                  {!back && <Text style={s.copy}>{card.card_type === 'man' ? 'Man' : suitName[card.suit!]} · {(card.deck_index ?? Number(card.card_id.slice(-1))) + 1}</Text>}
                </Pressable>;
              })}</View>
              {!hidden && <>
                {!allRevealed ? <View style={s.row}>{button(`Reveal next · ${revealed}/21`, () => setRevealed(n => Math.min(21, n + 1)))}{button('Reveal all cards', () => setRevealed(21))}</View> : <>
                  <View style={s.row}>{(availableHand.length <= 15 ? ['grid', 'fan', 'suits'] as const : ['grid', 'suits'] as const).map(v => <View key={v}>{button(v === 'grid' ? 'Grid' : v === 'fan' ? 'Arc' : 'Suit groups', () => setMode(v), false, mode === v)}</View>)}</View>
                  {mode === 'suits' && <View style={s.row}>{['all', 'S', 'C', 'H', 'D', 'man'].map(v => <View key={v}>{button(suitName[v] || (v === 'all' ? 'All' : 'Man'), () => setSuit(v), false, suit === v)}</View>)}</View>}
                  {button(selected.length === 1 ? `Discard ${physicalLabel(selected[0])}` : 'Select one card to discard', () => onAction('DISCARD_CARD', { card_id: selected[0] }),
                    !canAct || selected.length !== 1 || !actions?.discardable_card_ids.includes(selected[0]))}
                  {own?.route === 'unqualified' && <View style={s.builder}>
                    <Text style={s.heading}>Build your melds</Text>
                    {suggestions && <View style={s.builder}>
                      <Text style={s.text}>{suggestions.dublees.length || suggestions.normal.length ? 'Possible declarations found. Choose a route to review before showing.' : `Found ${suggestions.pairCount} pairs. No complete declaration yet.`}</Text>
                      {!!suggestions.dublees.length && button('Review seven Dublees', () => { setGroups(suggestions.dublees); setSelected([]); }, busy)}
                      {!!suggestions.normal.length && button('Review three melds', () => { setGroups(suggestions.normal); setSelected([]); }, busy)}
                    </View>}<Text style={s.small}>Tap cards, choose a group type, then add it. Submit seven Dublees or three sequences / Tunnelas together.</Text>
                    <View style={s.row}>{(['dublee', 'pure_sequence', 'tunnela'] as const).map(type => <View key={type}>{button(type === 'pure_sequence' ? 'Sequence' : type === 'dublee' ? 'Dublee' : 'Tunnela', () => setKind(type), false, kind === type)}</View>)}</View>
                    <View style={s.row}>{button('Check selected meld', () => onAction('VALIDATE_MELD', { meld: selectedMeld }), !canAct || selected.length < 2)}
                      {button(`Add group · ${selected.length} cards`, () => { setGroups(g => [...g, selectedMeld]); setSelected([]); }, selected.length < 2 || busy)}
                      {button('Clear selection', () => setSelected([]), !selected.length)}</View>
                    {snapshot.query_result?.command === 'VALIDATE_MELD' && snapshot.query_result.command_id === snapshot.action_ack?.command_id && <Text accessibilityLiveRegion="polite" style={s.success}>The selected meld is valid.</Text>}
                    {groups.map((group, i) => <View key={i} style={s.row}><Text style={[s.text, { flex: 1 }]}>{i + 1}. {group.meld_type.replace('_', ' ')} · {group.card_ids.map(physicalLabel).join('  ')}</Text>
                      {button(`Remove group ${i + 1}`, () => setGroups(g => g.filter((_, n) => n !== i)))}</View>)}
                    {button(declaration === 'SHOW_DUBLEES' ? 'Show seven Dublees' : 'Show three melds', () => declaration && onAction(declaration, declaration === 'SHOW_DUBLEES' ? { pairs: groups } : { melds: groups }),
                      !canAct || !declaration || !actions?.kinds.includes(declaration.toLowerCase()))}
                  </View>}
                </>}
                <View style={s.maal}><Text style={s.heading}>Maal</Text><Text style={s.text}>{mine.maal ? `Tiplu ${marriageFace(mine.maal.tiplu)} · Jhiplu ${marriageFace(mine.maal.jhiplu)} · Poplu ${marriageFace(mine.maal.poplu)}` : 'Hidden until your melds qualify.'}</Text></View>
              </>}
            </View> : <View style={s.panel}><Text style={s.text}>You are watching. Hands and Maal are visible only to entitled players.</Text></View>}
          </View>
          <View style={[s.panel, wide && { width: 280, alignSelf: 'flex-start' }]}>
            <View style={s.row}>{button('Players', () => setDetails('players'), false, details === 'players')}{button('Rules', () => setDetails('rules'), false, details === 'rules')}</View>
            {details === 'rules' ? <><Text style={s.text}>21 cards each. Take one card, optionally show melds, then discard.</Text><Text style={s.text}>Sequence: consecutive ranks in one suit, Ace low. Tunnela: three copies of one face. Dublee: two copies.</Text><Text style={s.text}>Show seven Dublees, then finish with an eighth uncommitted pair. A winning discard must be followed by Finish.</Text><Text style={s.text}>Three sequences / Tunnelas unlock Maal. Normal-hand winning and scoring are not available yet.</Text></>
              : pub.players.map(p => <View key={p.player_id} style={s.builder}><Text style={s.player}>{name(p.player_id)}</Text><Text style={s.small}>{p.shown_melds.length} groups shown</Text>
                {p.shown_melds.map((m, i) => <Text key={i} style={s.text}>{m.card_ids.map(physicalLabel).join('  ')}</Text>)}</View>)}
          </View>
        </View>
      </>}
      {!!error && <Text accessibilityRole="alert" style={s.error}>{error}</Text>}
    </ScrollView>
    {poke !== undefined && <PokeComposer recipient={poke} connected={social.connected} phrases={social.phrases} onSave={social.save}
      onSend={text => social.send(poke, text)} onClose={() => setPoke(undefined)} />}
  </View>;
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.navy }, header: { padding: 12, gap: 8, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' },
  title: { flex: 1, minWidth: 140, color: colors.champagne, fontFamily: fonts.medium, fontSize: 18 }, content: { padding: 12, gap: 12, paddingBottom: 30 },
  columns: { gap: 14 }, main: { flex: 1, minWidth: 0, gap: 14 }, panel: { backgroundColor: '#173046', borderRadius: 14, padding: 14, gap: 12 },
  table: { backgroundColor: '#123C35', borderRadius: 18, padding: 14, gap: 14, borderWidth: 1, borderColor: '#537E68' },
  seats: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, seat: { flexGrow: 1, flexBasis: 130, minWidth: 0, padding: 10, borderRadius: 10, borderWidth: 1, borderColor: '#537E68', gap: 5 }, activeSeat: { borderColor: '#76EEA3', borderWidth: 2 },
  player: { fontFamily: fonts.medium, color: colors.ivory, fontSize: 16 }, text: { fontFamily: fonts.body, color: colors.ivory, fontSize: 13, lineHeight: 21 },
  small: { fontFamily: fonts.body, color: '#BBC9D6', fontSize: 12, lineHeight: 19 }, heading: { fontFamily: fonts.medium, color: colors.champagne, fontSize: 16 },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 }, button: { minHeight: 44, backgroundColor: '#34516A', borderRadius: 8, padding: 10, alignItems: 'center', justifyContent: 'center' },
  chosen: { backgroundColor: colors.copper }, buttonText: { fontFamily: fonts.medium, color: colors.ivory, fontSize: 12 }, disabled: { opacity: 0.42 },
  piles: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 24, minHeight: 130 }, pileFace: { fontSize: 32, backgroundColor: colors.ivory, color: '#932F38', borderRadius: 8, padding: 14 },
  hand: { flexDirection: 'row', flexWrap: 'wrap', gap: 5, position: 'relative', paddingVertical: 6 }, card: { width: 49, height: 78, borderRadius: 7, borderWidth: 2, borderColor: '#D9C8B0', backgroundColor: colors.ivory, alignItems: 'center', justifyContent: 'space-around' },
  cardBack: { backgroundColor: '#688196', borderColor: '#CFB28A' }, selectedCard: { borderColor: '#63FF9C', backgroundColor: '#DAFFE7' }, face: { fontSize: 23, fontWeight: 'bold' }, copy: { color: '#4B5660', textAlign: 'center', fontSize: 8 },
  builder: { gap: 10, paddingTop: 12, borderTopWidth: 1, borderColor: '#FFFFFF26' }, maal: { backgroundColor: '#264C45', padding: 12, gap: 8, borderRadius: 8 },
  error: { color: '#FFD2D2', backgroundColor: '#632F37', padding: 14, borderRadius: 10 }, success: { color: '#7CECAA', fontSize: 13 },
});
