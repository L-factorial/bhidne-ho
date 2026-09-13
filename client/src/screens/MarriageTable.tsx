import { AppHeader } from '../components/AppHeader';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { fonts, useTheme, useThemedStyles, type ThemeColors } from '../theme';
import { useMarriageReveal } from '../multiplayer/useMarriageReveal';
import { MarriageCardArea } from '../components/MarriageCardArea';
import { MarriageMeldCards } from '../components/MarriageMeldCards';
import { MarriageCardBack } from '../components/MarriageCardBack';
import { MarriageDetails } from '../components/MarriagePlayers';
import { TurnPulse } from '../components/TurnPulse';
import { PokeComposer } from '../components/PokeComposer';
import type { PlayerPhrase } from '../multiplayer/pokes';
import type { RoomSnapshot } from './LiveGameTable';
import { canSubmitMarriage, marriageSuggestions, marriageUsesArc, marriageFace, physicalLabel, suitName, type MarriageMeld } from '../multiplayer/marriage';

export function MarriageTable({ snapshot, busy, error, onAction, onStart, onBack, onNewGame, onSave, endControl, lobbyControl, social }: {
  onSave: (rules: import('../multiplayer/marriage').MarriageScoringRules) => void;
  snapshot: RoomSnapshot; busy: boolean; error: string; endControl?: ReactNode; lobbyControl?: ReactNode;
  onAction: (command: string, payload?: object) => void; onStart: () => void; onBack: () => void; onNewGame: () => void;
  social: { connected: boolean; phrases: PlayerPhrase[]; save: (text: string) => Promise<void>; send: (recipient: number | null, text: string) => Promise<void> };
}) {
  const { colors } = useTheme();
  const s = useThemedStyles(createStyles);
  const [width, setWidth] = useState(300);
  const [mode, setMode] = useState<'grid' | 'fan' | 'suits'>('grid');
  const [suit, setSuit] = useState('all');
  const [hidden, setHidden] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [groups, setGroups] = useState<MarriageMeld[]>([]);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [preview, setPreview] = useState(false);
  const [shownPlayer, setShownPlayer] = useState<string | null>(null);
  const previousShown = useRef<string[] | null>(null);
  const showOpacity = useRef(new Animated.Value(0)).current;
  const showTravel = useRef(new Animated.Value(-70)).current;
  const [kind, setKind] = useState<MarriageMeld['meld_type']>('dublee');
  const [details, setDetails] = useState<'stats' | 'rules' | 'points' | null>(null);
  const [poke, setPoke] = useState<number | null | undefined>(undefined);
  const pub = snapshot.marriage?.public, mine = snapshot.marriage?.private;
  const hand = mine?.hand || [], actions = mine?.actions;
  const playStarted = !!snapshot.marriage?.moves?.length || !!pub?.players.some(p => p.hand_count !== 21 || p.shown_melds.length > 0) || snapshot.status === 'finished';
  const { revealed, reveal } = useMarriageReveal(snapshot.match_id, mine?.player_id, playStarted);
  const own = pub?.players.find(p => p.player_id === mine?.player_id);
  const committed = own?.shown_melds.flatMap(m => m.card_ids) || [];
  const handKey = hand.map(c => c.card_id).join(',') + committed.join(',');
  useEffect(() => {
    const available = hand.filter(c => !committed.includes(c.card_id)).map(c => c.card_id);
    setSelected(current => current.filter(id => available.includes(id)));
    setGroups(current => current.filter(g => g.card_ids.every(id => available.includes(id))));
  }, [handKey]);
  const publicShown = pub?.players.filter(p => p.shown_melds.length) || [];
  const shownKey = publicShown.map(p => p.player_id).join(',');
  useEffect(() => {
    const newlyShown = previousShown.current === null ? [] : publicShown.filter(p => !previousShown.current!.includes(p.player_id));
    if (newlyShown.length) setShownPlayer(newlyShown.at(-1)!.player_id);
    previousShown.current = publicShown.map(p => p.player_id);
    if (own?.route && own.route !== 'unqualified') setPreview(false);
  }, [shownKey, own?.route]);
  const publicDisplay = publicShown.find(p => p.player_id === shownPlayer);
  useEffect(() => {
    if (!shownPlayer) return;
    showOpacity.setValue(0); showTravel.setValue(-70);
    const animation = Animated.sequence([
      Animated.parallel([
        Animated.timing(showOpacity, { toValue: 1, duration: 200, useNativeDriver: true }),
        Animated.timing(showTravel, { toValue: 0, duration: 300, useNativeDriver: true }),
      ]),
      Animated.delay(3000),
      Animated.timing(showOpacity, { toValue: 0, duration: 500, useNativeDriver: true }),
    ]);
    animation.start(({ finished }) => { if (finished) setShownPlayer(null); });
    return () => animation.stop();
  }, [shownPlayer, showOpacity, showTravel]);
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
  const gridColumns = Math.max(1, Math.ceil(shown.length / 3), Math.floor((width + 6) / 62));
  const gridRows = Math.max(1, Math.ceil(shown.length / gridColumns));
  const gridCardWidth = Math.min(56, (width - (gridColumns - 1) * 6) / gridColumns);
  const gridCardHeight = Math.min(72, (156 - (gridRows - 1) * 6) / gridRows);
  const gridWidth = Math.min(shown.length, gridColumns) * (gridCardWidth + 6) - 6;
  const fanSpread = Math.min(90, Math.max(0, shown.length - 1) * 7);

  return <View style={s.page} testID="marriage-table">
    <AppHeader title="Marriage" actions={<>{endControl}{button('Collapse game', onBack)}</>} />
    <View style={s.detailsBar}>

      {(['stats', 'rules', 'points'] as const).map(section => <Pressable key={section} accessibilityRole="button" onPress={() => setDetails(section)} style={s.detailsTab}>
        <Text style={s.buttonText}>{section === 'stats' ? 'Stats' : section === 'rules' ? 'Rules' : 'Points'}</Text>
      </Pressable>)}
      {pub && mine && <Pressable accessibilityRole="button" accessibilityLabel="Hand tools" onPress={() => setToolsOpen(true)} style={s.detailsTab}><Text style={s.buttonText}>Hand tools</Text></Pressable>}
    </View>
    <View testID="marriage-play-area" style={s.playArea}>
      {!pub ? <View style={s.panel}>
        <Text style={s.heading}>{snapshot.players?.length}/{snapshot.capacity} players seated</Text>
        {snapshot.players?.map(p => <Text key={p.player_id} style={s.text}>{p.display_name || `Player ${p.player_id}`}{p.player_id === snapshot.your_player_id ? ' · You' : ''}</Text>)}
        <Text style={s.text}>Build seven pairs, see Maal, then finish with an eighth pair. Normal qualification is available; normal-hand winning comes later. Open Rules to select scoring before starting.</Text>
        <Text style={s.text}>Each player draws, shows melds, and discards on their own turn. Play waits for disconnected players to return.</Text>
        {snapshot.is_creator ? button('Start game', onStart, busy || !snapshot.ready) : <Text style={s.text}>Waiting for the creator to start.</Text>}
        {lobbyControl}
      </View> : <>
        {snapshot.status === 'finished' && <View style={s.panel}><Text accessibilityRole="header" style={s.heading}>{name(pub.winner)} wins!</Text>
          <Text style={s.text}>Eight Dublees complete. Ready for another round?</Text>{button('Start a new game', onNewGame)}</View>}
        <View style={s.columns}>
          <View style={s.main}>
            <View style={s.table}>
              <MarriageCardArea snapshot={snapshot} canAct={canAct} hidden={hidden || !allRevealed} onAction={onAction} onPoke={setPoke} />
              {snapshot.status === 'playing' && <TurnPulse personal={isTurn} text={isTurn ? `Your turn · ${pub.phase === 'must_draw' ? 'Take a card' : 'Show, finish, or discard'}` : `${name(pub.current_player_id)}’s turn`} />}
              {actions?.kinds.includes('finish') && button('Finish round', () => onAction('FINISH'), !canAct)}
            </View>

          </View>
        </View>
      </>}
      {!!error && <Text accessibilityRole="alert" style={s.error}>{error}</Text>}
    </View>
    {pub && mine && <View testID="marriage-hand-dock" style={s.handDock} onLayout={e => setWidth(Math.max(120, e.nativeEvent.layout.width - 24))}>
      <View style={s.row}><Text style={s.heading}>Your cards · {availableHand.length}</Text>{allRevealed && button(hidden ? 'Show cards' : 'Hide cards', () => { setHidden(v => !v); setSelected([]); })}</View>
      <View testID="marriage-hand" style={[s.hand, { height: 156, width }]}>{shown.map((card, index) => {
        const back = hidden || (!allRevealed && index >= revealed);
        const locked = committed.includes(card.card_id) || staged.includes(card.card_id), checked = selected.includes(card.card_id);
        return <Pressable key={card.card_id} accessibilityRole="button" accessibilityLabel={back ? 'Reveal next card' : `${physicalLabel(card.card_id)}${locked ? ' grouped' : ''}`}
          accessibilityState={{ selected: checked, disabled: busy || hidden || (allRevealed && locked) }} disabled={busy || hidden || (allRevealed && locked)}
          onPress={() => !allRevealed ? reveal() : setSelected(ids => checked ? ids.filter(id => id !== card.card_id) : [...ids, card.card_id])}
          style={[s.card, back && s.cardBack, checked && s.selectedCard, locked && !back && { opacity: 0.55 }, !fan && { position: 'absolute', width: gridCardWidth, height: gridCardHeight,
            left: (width - gridWidth) / 2 + (index % gridColumns) * (gridCardWidth + 6),
            top: Math.floor(index / gridColumns) * (gridCardHeight + 6) + (checked ? 0 : 4) }, fan && {
            position: 'absolute', width: 52, height: 110, left: width / 2 - 26 + (shown.length > 1 ? index / (shown.length - 1) * 2 - 1 : 0) * 18,
            top: checked ? 4 : 14, transformOrigin: 'bottom center',
            transform: [{ rotate: `${shown.length > 1 ? index / (shown.length - 1) * fanSpread - fanSpread / 2 : 0}deg` }],
          }]} >
          {back ? <MarriageCardBack /> : <Text style={[s.face, fan ? { position: 'absolute', top: 4, left: 4, fontSize: 17 } : { fontSize: gridCardWidth < 45 ? 16 : 21 }, { color: card.suit === 'H' || card.suit === 'D' ? colors.cardRed : card.suit === 'C' ? colors.cardClub : colors.cardInk }]}>{marriageFace(card)}</Text>}
          {!back && !fan && <Text numberOfLines={1} style={s.copy}>{card.card_type === 'man' ? 'Man' : suitName[card.suit!]} · {(card.deck_index ?? Number(card.card_id.slice(-1))) + 1}</Text>}
        </Pressable>;
      })}</View>
      {!hidden && (!allRevealed ? <View style={s.row}>{button(`Reveal next · ${revealed}/21`, () => reveal())}{button('Reveal all cards', () => reveal(true))}</View> : <>
          {button(selected.length === 1 ? `Discard ${physicalLabel(selected[0])}` : 'Select one card to discard', () => onAction('DISCARD_CARD', { card_id: selected[0] }),
            !canAct || selected.length !== 1 || !actions?.discardable_card_ids.includes(selected[0]))}
      </>)}
    </View>}
    {publicDisplay && <View pointerEvents="none" style={s.shownOverlay}>
      <Animated.View testID="marriage-shown-melds" style={[s.shownCards, { opacity: showOpacity, transform: [{ translateY: showTravel }] }]}>
        <Text accessibilityLiveRegion="polite" style={s.heading}>{name(publicDisplay.player_id)} showed {publicDisplay.route === 'dublee' ? 'seven Dublees' : 'three sequences / Tunnelas'}</Text>
        <MarriageMeldCards groups={publicDisplay.shown_melds} />
      </Animated.View>
    </View>}
    <Modal transparent visible={toolsOpen} animationType="none" onRequestClose={() => setToolsOpen(false)}>
      <View style={s.previewBackdrop}><View accessibilityViewIsModal testID="marriage-hand-tools" style={s.previewPanel}>
        <View style={s.row}><Text accessibilityRole="header" style={[s.heading, { flex: 1 }]}>Hand tools</Text>{button('Close hand tools', () => setToolsOpen(false))}</View>
        <ScrollView contentContainerStyle={{ gap: 12 }}>
            {mine && <View style={s.panel}>
              {!hidden && <>
                {allRevealed && <>
                  <View style={s.row}>{(availableHand.length <= 15 ? ['grid', 'fan', 'suits'] as const : ['grid', 'suits'] as const).map(v => <View key={v}>{button(v === 'grid' ? 'Grid' : v === 'fan' ? 'Arc' : 'Suit groups', () => setMode(v), false, mode === v)}</View>)}</View>
                  {mode === 'suits' && <View style={s.row}>{['all', 'S', 'C', 'H', 'D', 'man'].map(v => <View key={v}>{button(suitName[v] || (v === 'all' ? 'All' : 'Man'), () => setSuit(v), false, suit === v)}</View>)}</View>}
                  {own?.route === 'unqualified' && <View style={s.builder}>
                    <Text style={s.heading}>Build your melds</Text>
                    {suggestions && <View style={s.builder}>
                      <Text style={s.text}>{suggestions.dublees.length || suggestions.normal.length ? 'Possible declarations found. Choose a route to review before showing.' : `Found ${suggestions.pairCount} pairs. No complete declaration yet.`}</Text>
                      {!!suggestions.dublees.length && button('Review seven Dublees', () => { setGroups(suggestions.dublees); setSelected([]); setToolsOpen(false); setPreview(true); }, busy)}
                      {!!suggestions.normal.length && button('Review three melds', () => { setGroups(suggestions.normal); setSelected([]); setToolsOpen(false); setPreview(true); }, busy)}
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
            </View>}
          {mine && button('Poke the table', () => { setToolsOpen(false); setPoke(null); }, !social.connected)}
          {!!error && <Text accessibilityRole="alert" style={s.error}>{error}</Text>}
        </ScrollView>
      </View></View>
    </Modal>
    <Modal transparent visible={preview} animationType="none" onRequestClose={() => setPreview(false)}>
      <View style={s.previewBackdrop}><View accessibilityViewIsModal testID="marriage-meld-preview" style={s.previewPanel}>
        <View style={s.row}><Text accessibilityRole="header" style={[s.heading, { flex: 1 }]}>Your declaration</Text>{button('Close preview', () => setPreview(false))}</View>
        <ScrollView contentContainerStyle={{ gap: 14 }}>
          <Text style={s.small}>Only you can see this preview. Show these groups to reveal them to everyone.</Text>
          <MarriageMeldCards groups={groups} />
          {!!error && <Text accessibilityRole="alert" style={s.error}>{error}</Text>}
          {button(declaration === 'SHOW_DUBLEES' ? 'Show seven Dublees' : 'Show three melds', () => declaration && onAction(declaration, declaration === 'SHOW_DUBLEES' ? { pairs: groups } : { melds: groups }),
            !canAct || !declaration || !actions?.kinds.includes(declaration.toLowerCase()))}
          {!actions?.kinds.includes(declaration?.toLowerCase() || '') && <Text style={s.small}>You can show after drawing on your turn.</Text>}
        </ScrollView>
      </View></View>
    </Modal>
    <MarriageDetails busy={busy} error={error} onSave={onSave} snapshot={snapshot} section={details} onClose={() => setDetails(null)} />
    {poke !== undefined && <PokeComposer recipient={poke} connected={social.connected} phrases={social.phrases} onSave={social.save}
      onSend={text => social.send(poke, text)} onClose={() => setPoke(undefined)} />}
  </View>;
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  shownOverlay: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, zIndex: 60, alignItems: 'center', justifyContent: 'center', padding: 16 },
  shownCards: { width: '100%', maxWidth: 620, maxHeight: '85%', padding: 14, gap: 12, backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.cardBorder, overflow: 'hidden' },
  previewBackdrop: { flex: 1, backgroundColor: colors.overlay, padding: 20, justifyContent: 'center', alignItems: 'center' },
  previewPanel: { width: '100%', maxWidth: 640, maxHeight: '90%', backgroundColor: colors.surface, borderRadius: 16, padding: 16, gap: 16 },
  playArea: { flex: 1, minHeight: 0, padding: 8, gap: 6 }, handDock: { flexShrink: 0, padding: 12, gap: 6, backgroundColor: colors.surface, borderTopWidth: 1, borderColor: colors.border },
  page: { flex: 1, minHeight: 0, backgroundColor: colors.background }, header: { padding: 12, gap: 8, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' },
  title: { flex: 1, minWidth: 140, color: colors.accent, fontFamily: fonts.medium, fontSize: 18 }, content: { padding: 12, gap: 12, paddingBottom: 30 },
  detailsBar: { flexDirection: 'row', marginHorizontal: 12, borderRadius: 8, backgroundColor: colors.surface, marginBottom: 2 },
  detailsTab: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  columns: { flex: 1, minHeight: 0 }, main: { flex: 1, minHeight: 0, minWidth: 0 }, panel: { backgroundColor: colors.surface, borderRadius: 14, padding: 14, gap: 12 },
  table: { flex: 1, minHeight: 0, backgroundColor: colors.surface, borderRadius: 18, padding: 8, gap: 4, borderWidth: 1, borderColor: colors.border },
  seats: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, seat: { flexGrow: 1, flexBasis: 130, minWidth: 0, padding: 10, borderRadius: 10, borderWidth: 1, borderColor: colors.border, gap: 5 }, activeSeat: { borderColor: colors.turnText, borderWidth: 2 },
  player: { fontFamily: fonts.medium, color: colors.text, fontSize: 16 }, text: { fontFamily: fonts.body, color: colors.text, fontSize: 13, lineHeight: 21 },
  small: { fontFamily: fonts.body, color: colors.textMuted, fontSize: 12, lineHeight: 19 }, heading: { fontFamily: fonts.medium, color: colors.accent, fontSize: 16 },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 }, button: { minHeight: 44, backgroundColor: colors.surfaceRaised, borderRadius: 8, padding: 10, alignItems: 'center', justifyContent: 'center' },
  chosen: { backgroundColor: colors.surfaceSelected }, buttonText: { fontFamily: fonts.medium, color: colors.text, fontSize: 12 }, disabled: { opacity: 0.42 },
  piles: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 24, minHeight: 130 }, pileFace: { fontSize: 32, backgroundColor: colors.cardFace, color: colors.cardRed, borderRadius: 8, padding: 14 },
  hand: { flexDirection: 'row', flexWrap: 'wrap', gap: 5, position: 'relative', paddingVertical: 6 }, card: { width: 49, height: 78, borderRadius: 7, borderWidth: 2, borderColor: colors.cardBorder, backgroundColor: colors.cardFace, alignItems: 'center', justifyContent: 'center', gap: 3 },
  cardBack: { backgroundColor: colors.cardBack, borderColor: colors.cardBorder }, selectedCard: { borderColor: colors.cardSelectedBorder, borderWidth: 3, backgroundColor: colors.cardSelected }, face: { fontFamily: fonts.medium, fontSize: 23, fontWeight: 'bold' }, copy: { color: colors.cardInk, textAlign: 'center', fontSize: 8 },
  builder: { gap: 10, paddingTop: 12, borderTopWidth: 1, borderColor: colors.border }, maal: { backgroundColor: colors.surface, padding: 12, gap: 8, borderRadius: 8 },
  error: { color: colors.danger, backgroundColor: colors.dangerSurface, padding: 14, borderRadius: 10 }, success: { color: colors.success, fontSize: 13 },
});
