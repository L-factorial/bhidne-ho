import { useTableSocial } from '../components/TableSocial';
import { TurnIndicator } from '../components/TurnIndicator';
import { EndedTableNotice } from '../components/EndedTableNotice';
import { GameMenu, GameMenuMetadata } from '../components/GameMenu';
import { GameTableHeader } from '../components/GameTableHeader';
import { MarriageHandSheet } from '../components/MarriageHandSheet';
import { marriageDecision, marriageHandSnap, marriageHandLayout, type HandSnap } from '../multiplayer/marriageWorkspace';
import { TableStartCue } from '../components/TableStartCue';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Modal, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { fonts, primaryAction, useTheme, useThemedStyles, type ThemeColors } from '../theme';
import { useMarriageReveal } from '../multiplayer/useMarriageReveal';
import { MarriageCardArea } from '../components/MarriageCardArea';
import { MarriageMeldCards } from '../components/MarriageMeldCards';
import { MarriageCardBack } from '../components/MarriageCardBack';
import { MarriageDetails } from '../components/MarriagePlayers';
import { PokeComposer } from '../components/PokeComposer';
import type { PlayerPhrase } from '../multiplayer/pokes';
import type { RoomSnapshot } from './LiveGameTable';
import { canSubmitMarriage, marriageSuggestions, marriageUsesArc, marriageFace, physicalLabel, suitName, type MarriageMeld } from '../multiplayer/marriage';

export function MarriageTable({ snapshot, busy, error, onAction, onStart, onBack, onNewGame, onSave, endControl, lobbyControl, social, tableControl, onTableAction }: {
  tableControl?: ReactNode; onTableAction: (command: string) => void;
  onSave: (rules: import('../multiplayer/marriage').MarriageScoringRules) => void;
  snapshot: RoomSnapshot; busy: boolean; error: string; endControl?: ReactNode; lobbyControl?: ReactNode;
  onAction: (command: string, payload?: object) => void; onStart: () => void; onBack: () => void; onNewGame: () => void;
  social: { connected: boolean; phrases: PlayerPhrase[]; save: (text: string) => Promise<void>; send: (recipient: number | null, text: string) => Promise<void> };
}) {
  const { colors } = useTheme();
  const ended = snapshot.status === 'ended';
  const endedNotice = <EndedTableNotice onBack={onBack} onNewGame={onNewGame} />;
  const s = useThemedStyles(createStyles);
  const mobile = useWindowDimensions().width < 900;
  const [width, setWidth] = useState(300);
  const [mode, setMode] = useState<'grid' | 'fan' | 'suits'>('grid');
  const [suit, setSuit] = useState('all');
  const [hidden, setHidden] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [selectingMeld, setSelectingMeld] = useState(false);
  const [groups, setGroups] = useState<MarriageMeld[]>([]);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [hintsOpen, setHintsOpen] = useState(false);
  const [preview, setPreview] = useState(false);
  const [finishPreview, setFinishPreview] = useState(false);
  const [sortBy, setSortBy] = useState<'suit' | 'rank'>('suit');
  const handAnchor = useRef<View>(null);
  const tableSocial = useTableSocial();
  const [shownPlayer, setShownPlayer] = useState<string | null>(null);
  const previousShown = useRef<string[] | null>(null);
  const showOpacity = useRef(new Animated.Value(0)).current;
  const showTravel = useRef(new Animated.Value(-70)).current;
  const [kind, setKind] = useState<MarriageMeld['meld_type']>('dublee');
  const [details, setDetails] = useState<'stats' | 'rules' | 'points' | null>(null);
  const [poke, setPoke] = useState<number | null | undefined>(undefined);
  const pub = snapshot.marriage?.public, mine = snapshot.marriage?.private;
  const hand = mine?.hand || [], actions = mine?.actions;
  // Revealing is local: another player's move must not expose this hand.
  const { revealed, reveal } = useMarriageReveal(snapshot.match_id, mine?.player_id, false);
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
    if (own?.route && own.route !== 'unqualified') { setPreview(false); setSelectingMeld(false); }
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
  // The private hand preserves receipt order; draws append, even after reconnecting.
  const drawnCard = isTurn && pub?.phase === 'must_discard' ? hand.at(-1) : undefined;
  const activeGame = snapshot.status === 'playing';
  const decision = marriageDecision(snapshot.marriage, activeGame);
  const [snap, setSnap] = useState<HandSnap>(() => marriageHandSnap(decision));
  // Only a new decision changes the sheet; polling, selecting and showing melds do not.
  useEffect(() => {
    setSnap(marriageHandSnap(decision));
    setSelected([]); setSelectingMeld(false);
  }, [decision, snapshot.match_id, mine?.player_id]);
  const cards = {
    open: snap !== 'collapsed',
    setOpen: (open: boolean) => setSnap(open ? 'expanded' : 'collapsed'),
    act: onAction,
  };
  const normalFinish = actions?.normal_finish;
  useEffect(() => {
    if (!activeGame || !normalFinish || hidden || !allRevealed) setFinishPreview(false);
  }, [activeGame, normalFinish, hidden, allRevealed]);
  const staged = groups.flatMap(g => g.card_ids);
  const hints = useMemo(() => allRevealed ? marriageSuggestions(availableHand.filter(c => !staged.includes(c.card_id))) : null,
    [handKey, allRevealed, staged.join(',')]);
  const detectedGroups = [...(hints?.pairs || []), ...(hints?.melds || [])];
  const detectedIds = new Set(detectedGroups.flatMap(g => g.card_ids));
  const detectedSelection = detectedGroups.find(g => g.card_ids.length === selected.length && g.card_ids.every(id => selected.includes(id)));
  const declaration = canSubmitMarriage(groups);
  const selectedMeld = { meld_type: kind, card_ids: selected };
  function button(label: string, action: () => void, disabled = false, chosen = false) {
    const primary = /^(Finish round|Confirm finish|Show three melds|Show seven Dublees)$/.test(label);
    return <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled}
      accessibilityState={{ disabled, selected: chosen }} onPress={action} style={({ pressed }) => [s.button, chosen && s.chosen, primary && primaryAction(colors, pressed), disabled && s.disabled]}>
      <Text style={[s.buttonText, primary && { color: colors.onPrimary }]}>{label}</Text></Pressable>;
  }
  const shown = !allRevealed ? availableHand : [...availableHand].filter(c => mode !== 'suits' || suit === 'all' || (c.suit || 'man') === suit)
    .sort((a, b) => (sortBy === 'rank' ? (a.rank || 0) - (b.rank || 0) : (a.suit || 'Z').localeCompare(b.suit || 'Z')) || (a.rank || 0) - (b.rank || 0) || (a.suit || 'Z').localeCompare(b.suit || 'Z') || a.card_id.localeCompare(b.card_id));
  const mobileLayout = marriageHandLayout(shown.length, width);
  const fan = !mobile && marriageUsesArc(availableHand.length, mode, !allRevealed);
  const gridColumns = Math.max(1, Math.ceil(shown.length / 3), Math.floor((width + 6) / 62));
  const gridRows = Math.max(1, Math.ceil(shown.length / gridColumns));
  const gridCardWidth = Math.min(56, (width - (gridColumns - 1) * 6) / gridColumns);
  const gridCardHeight = Math.min(72, (156 - (gridRows - 1) * 6) / gridRows);
  const gridWidth = Math.min(shown.length, gridColumns) * (gridCardWidth + 6) - 6;
  const fanSpread = Math.min(90, Math.max(0, shown.length - 1) * 7);
  const cardPosition = (index: number, checked: boolean) => mobile ? {
    left: (index % mobileLayout.columns) * mobileLayout.step,
    top: Math.floor(index / mobileLayout.columns) * 100 + (checked ? 0 : 12),
  } : !fan ? {
    left: (width - gridWidth) / 2 + (index % gridColumns) * (gridCardWidth + 6),
    top: Math.floor(index / gridColumns) * (gridCardHeight + 6) + (checked ? 0 : 4),
  } : {
    left: width / 2 - 26 + (shown.length > 1 ? index / (shown.length - 1) * 2 - 1 : 0) * 18,
    top: checked ? 4 : 14,
  };

  const startCue = ended ? endedNotice : <TableStartCue snapshot={snapshot} busy={busy} onStart={onStart} onTableAction={onTableAction} onNewGame={onNewGame} />;
  const hintsButton = !hidden && !!detectedGroups.length && <Pressable testID="marriage-meld-hints" accessibilityRole="button" accessibilityLabel="Review detected melds and Dublees"
    onPress={() => setHintsOpen(true)} style={s.button}>
    <Text style={s.buttonText}>{hints!.pairs.length} Dublees · {hints!.melds.length} meld options · Review</Text>
  </Pressable>;
  const canDiscard = canAct && isTurn && !!actions?.kinds.includes('discard');
  const discardSelected = !selectingMeld && selected.length === 1 && !!actions?.discardable_card_ids.includes(selected[0]);
  const selectedCard = discardSelected ? hand.find(card => card.card_id === selected[0]) : null;
  const turnInstruction = decision === 'DRAW_REQUIRED' ? 'Your turn · Draw a card'
    : decision === 'DISCARD_REQUIRED' ? 'Your turn · Choose a card to discard'
    : decision === 'FINISH_REQUIRED' ? 'Your turn · Finish round' : `Your cards · ${hand.length}`;
  const turnPrompt = activeGame && pub && <TurnIndicator testID="marriage-turn-instruction" personal={isTurn}
    text={isTurn && decision !== 'WAITING' ? turnInstruction : `${name(pub.current_player_id)}’s turn`} />;
  const mobileHandHeader = <View testID="marriage-hand-header" style={{ backgroundColor: colors.surface, paddingHorizontal: 10, gap: 4 }}>
    {!mobile && turnPrompt}
    {actions?.kinds.includes('finish') && button('Finish round', () => normalFinish ? setFinishPreview(true) : cards.act('FINISH'), !canAct)}
    {!!error && !selectedCard && <Text accessibilityRole="alert" style={s.error}>{error}</Text>}
  </View>;
  const discardFooter = selectedCard && <>
    {!!error && <Text accessibilityRole="alert" style={[s.small, { color: colors.danger }]}>{error}</Text>}
    <Pressable testID="marriage-discard-action" accessibilityRole="button" accessibilityLabel={`Discard ${physicalLabel(selectedCard.card_id)}`}
      disabled={!canDiscard} accessibilityState={{ disabled: !canDiscard }} onPress={() => cards.act('DISCARD_CARD', { card_id: selectedCard.card_id })}
      style={({ pressed }) => [s.button, primaryAction(colors, pressed), !canDiscard && s.disabled]}><Text style={[s.buttonText, { color: colors.onPrimary }]}>{busy ? 'Sending…' : `Discard ${marriageFace(selectedCard)}`}</Text></Pressable>
  </>;
  useEffect(() => {
    if (error && !busy && selectedCard && decision === 'DISCARD_REQUIRED') setSnap('expanded');
  }, [error, busy, selectedCard?.card_id, decision]);
  return <View style={s.page} testID="marriage-table">
    <GameTableHeader compact title="Marriage" path={snapshot.path} game="marriage" roomId={snapshot.room_id} matchId={snapshot.match_id} onBack={onBack}
      drawerMetadata={<GameMenuMetadata snapshot={snapshot} />}>
      {close => <GameMenu snapshot={snapshot} close={close} back={onBack} tableControl={tableControl} leaveControl={lobbyControl} endControl={endControl}
        poke={() => setPoke(null)} pokePlayer={setPoke} canPoke={social.connected}
        gameActions={(['stats', 'rules', 'points'] as const).map(section => ({ label: section === 'stats' ? 'Stats' : section === 'rules' ? 'Rules' : 'Points', action: () => setDetails(section) }))} />}
    </GameTableHeader>
    <View style={{ flex: 1, minHeight: 0 }}>
    <View testID="marriage-play-area" style={[s.playArea, mobile && mine && activeGame && { paddingBottom: 64 }]}>
      {ended && !pub ? <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>{endedNotice}</View> : !pub ? <ScrollView contentContainerStyle={s.panel}>
        <View style={[s.table, { minHeight: 180 }]}>{startCue}</View>
        <Text style={s.heading}>{snapshot.players?.length}/{snapshot.capacity} players seated</Text>
        {snapshot.players?.map(p => <Text key={p.player_id} style={s.text}>{p.display_name || `Player ${p.player_id}`}{p.player_id === snapshot.your_player_id ? ' · You' : ''}</Text>)}
        <Text style={s.text}>Show three natural melds, see Maal, then complete 21 cards in sequences or sets and discard one to win. Or show seven Dublees and finish with an eighth pair. Open Rules to select scoring before starting.</Text>
        <Text style={s.text}>Each player draws, shows melds, and discards on their own turn. Play waits for disconnected players to return.</Text>
        {!snapshot.is_creator && <Text style={s.text}>Waiting for the creator to start.</Text>}
      </ScrollView> : <>
        {snapshot.status === 'finished' && <View style={s.panel}><Text accessibilityRole="header" style={s.heading}>{name(pub.winner)} wins!</Text>
          <Text style={s.text}>{pub.normal_finish ? 'Normal hand complete.' : 'Eight Dublees complete.'} Ready for another round?</Text>
          {pub.normal_finish && button('View winning hand', () => setDetails('points'))}{startCue}</View>}
        <View style={s.columns}>
          <View style={s.main}>
            <View style={s.table}>
              <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center' }}><MarriageCardArea snapshot={snapshot} handAnchor={handAnchor} canAct={!busy && activeGame} onAction={cards.act} onPoke={activeGame || ended ? undefined : setPoke} /></ScrollView>
              <View style={tableSocial?.canRead ? { marginBottom: 60 } : undefined}>{turnPrompt}</View>
              {ended && <View testID="ended-table-overlay" style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, alignItems: 'center', justifyContent: 'center', zIndex: 70 }}>{endedNotice}</View>}

            </View>

          </View>
        </View>
      </>}
      {!!error && (!mine || !activeGame || (mobile && snap === 'collapsed')) && <Text accessibilityRole="alert" style={s.error}>{error}</Text>}
    </View>
    {pub && mine && activeGame && <MarriageHandSheet anchor={handAnchor} mobile={mobile} snap={snap} onSnap={setSnap} instruction={turnInstruction} attention={isTurn} header={mobileHandHeader} footer={discardFooter}>
    <View testID="marriage-hand-dock" style={[s.handDock, mobile && { backgroundColor: 'transparent', borderTopWidth: 0, padding: 4 }]} onLayout={e => { if (e.nativeEvent.layout.width > 48) setWidth(e.nativeEvent.layout.width - (mobile ? 8 : 24)); }}>
      <View style={[s.row, { backgroundColor: colors.tableHeader, borderRadius: 8 }]}><Text style={[s.small, { color: colors.onTableHeader }]}>Your cards · {hand.length}</Text>
        {!allRevealed && button('Reveal cards', () => reveal(true), busy)}
        {allRevealed && button(hidden ? 'Show cards' : 'Hide cards', () => { setHidden(v => !v); setSelected([]); })}
      </View>
      {!hidden && allRevealed && drawnCard && <Text testID="marriage-drawn-card" accessibilityLiveRegion="polite" style={s.heading}>You drew {physicalLabel(drawnCard.card_id)}</Text>}
      {selectingMeld && <View style={s.row}><Text style={s.small}>Select multiple cards for a meld.</Text>{button('Done selecting meld', () => { setSelectingMeld(false); setSelected([]); })}</View>}
      <View testID="marriage-hand" style={[s.hand, { height: mobile ? mobileLayout.height : 184, width }]}>{shown.map((card, index) => {
        const back = hidden || (!allRevealed && index >= revealed);
        const locked = committed.includes(card.card_id) || staged.includes(card.card_id), checked = selected.includes(card.card_id);
        const position = cardPosition(index, checked);
        return <View key={card.card_id} style={[{ position: 'absolute', zIndex: checked ? 100 : index }, position]}><Pressable accessibilityRole="button" accessibilityLabel={back ? 'Hidden card' : `${physicalLabel(card.card_id)}${locked ? ' grouped' : ''}`}
          accessibilityHint={!back && card.card_id === drawnCard?.card_id ? 'Just drawn' : undefined}
          aria-pressed={checked}
          accessibilityState={{ selected: checked, disabled: busy || back || locked }} disabled={busy || back || locked}
          onPress={() => setSelected(ids => selectingMeld
            ? ids.includes(card.card_id) ? ids.filter(id => id !== card.card_id) : [...ids, card.card_id]
            : ids.length === 1 && ids[0] === card.card_id ? [] : [card.card_id])}
          style={[s.card, back && s.cardBack, !back && card.card_id === drawnCard?.card_id && s.drawnCard, checked && s.selectedCard, locked && !back && { opacity: 0.55 }, mobile ? { width: mobileLayout.cardWidth, height: mobileLayout.cardHeight } : !fan && { width: gridCardWidth, height: gridCardHeight }, fan && {
            width: 52, height: 110, transformOrigin: 'bottom center',
            transform: [{ rotate: `${shown.length > 1 ? index / (shown.length - 1) * fanSpread - fanSpread / 2 : 0}deg` }],
          }]} >
          {back ? <MarriageCardBack /> : <Text style={[s.face, mobile || fan ? { position: 'absolute', top: 4, left: 3, fontSize: mobile ? 19 : 17 } : { fontSize: gridCardWidth < 45 ? 16 : 21 }, { color: card.suit === 'H' || card.suit === 'D' ? colors.cardRed : card.suit === 'C' ? colors.cardClub : colors.cardInk }]}>{marriageFace(card)}</Text>}
          {!back && card.card_id === drawnCard?.card_id && <Text style={{ position: 'absolute', bottom: 2, fontSize: 9, fontWeight: 'bold', color: colors.cardInk }}>NEW</Text>}
          {!back && !locked && detectedIds.has(card.card_id) && <View pointerEvents="none" style={{ position: 'absolute', right: 2, top: 2, width: 5, height: 5, borderRadius: 3, backgroundColor: colors.accent }} />}
          {!back && !fan && <Text numberOfLines={1} style={s.copy}>{card.card_type === 'man' ? 'Man' : suitName[card.suit!]} · {(card.deck_index ?? Number(card.card_id.slice(-1))) + 1}</Text>}
        </Pressable></View>;
      })}</View>
      {!hidden && allRevealed && own?.route === 'unqualified' && <View testID="marriage-declaration-controls" style={{ gap: 6 }}>
        {!!detectedSelection && button(detectedSelection.meld_type === 'dublee' ? 'Stage selected Dublee' : 'Stage selected meld', () => {
          setGroups(current => [...current, detectedSelection]); setSelected([]); setSelectingMeld(false);
        }, busy)}
        {!!groups.length && <>
          <Text style={s.small}>Staged privately · {groups.length} groups. Showing needs three melds or seven Dublees.</Text>
          <ScrollView horizontal contentContainerStyle={{ gap: 6 }}>{groups.map((group, index) => <View key={index}>
            {button(`Remove staged ${group.meld_type === 'dublee' ? 'Dublee' : 'meld'} ${index + 1}`, () => setGroups(current => current.filter((_, i) => i !== index)), busy)}
          </View>)}</ScrollView>
          {button('Review declaration', () => setPreview(true), !declaration || busy)}
        </>}
      </View>}
      {allRevealed && <View style={s.row}>
        {button(`Sort · ${sortBy}`, () => setSortBy(value => value === 'suit' ? 'rank' : 'suit'))}
        {!hidden && own?.route === 'unqualified' && button('Group', () => { setSelectingMeld(true); setSelected([]); })}
        {button('Arrange', () => setToolsOpen(true))}
      </View>}
      {hintsButton}
    </View></MarriageHandSheet>}
    </View>
    <Modal transparent visible={!ended && hintsOpen && !hidden && allRevealed} animationType="none" onRequestClose={() => setHintsOpen(false)}>
      <View style={s.previewBackdrop}><View accessibilityViewIsModal testID="marriage-hints-dialog" style={s.previewPanel}>
        <View style={s.row}><Text accessibilityRole="header" style={[s.heading, { flex: 1 }]}>Detected melds and Dublees</Text>{button('Close detected groups', () => setHintsOpen(false))}</View>
        <Text style={s.small}>Tap a group to select its cards. Options may overlap; showing requires three sequences/Tunnelas or seven Dublees.</Text>
        <ScrollView contentContainerStyle={{ gap: 8 }}>
          {detectedGroups.map(group => <View key={`${group.meld_type}:${group.card_ids.join(',')}`}>
            {button(`Select ${group.meld_type === 'dublee' ? 'Dublee' : group.meld_type === 'tunnela' ? 'Tunnela' : 'sequence'} · ${group.card_ids.map(physicalLabel).join(', ')}`, () => {
              setSelected(group.card_ids); setSelectingMeld(false); setKind(group.meld_type); setMode('grid'); setSuit('all'); cards.setOpen(true); setHintsOpen(false);
            }, busy)}
          </View>)}
          {!detectedGroups.length && <Text style={s.text}>No available melds or Dublees.</Text>}
        </ScrollView>
      </View></View>
    </Modal>
    {!ended && publicDisplay && <View pointerEvents="none" style={s.shownOverlay}>
      <Animated.View testID="marriage-shown-melds" style={[s.shownCards, { opacity: showOpacity, transform: [{ translateY: showTravel }] }]}>
        <Text accessibilityLiveRegion="polite" style={s.heading}>{name(publicDisplay.player_id)} showed {publicDisplay.route === 'dublee' ? 'seven Dublees' : 'three sequences / Tunnelas'}</Text>
        <MarriageMeldCards groups={publicDisplay.shown_melds} />
      </Animated.View>
    </View>}
    <Modal transparent visible={!ended && toolsOpen} animationType="none" onRequestClose={() => setToolsOpen(false)}>
      <View style={s.previewBackdrop}><View accessibilityViewIsModal testID="marriage-hand-tools" style={s.previewPanel}>
        <View style={s.row}><Text accessibilityRole="header" style={[s.heading, { flex: 1 }]}>Hand tools</Text>{button('Close hand tools', () => setToolsOpen(false))}</View>
        <ScrollView contentContainerStyle={{ gap: 12 }}>
            {mine && <View style={s.panel}>
              {!hidden && <>
                {allRevealed && <>
                  <View style={s.row}>{(!mobile && availableHand.length <= 15 ? ['grid', 'fan', 'suits'] as const : ['grid', 'suits'] as const).map(v => <View key={v}>{button(v === 'grid' ? 'Grid' : v === 'fan' ? 'Arc' : 'Suit groups', () => setMode(v), false, mode === v)}</View>)}</View>
                  {mode === 'suits' && <View style={s.row}>{['all', 'S', 'C', 'H', 'D', 'man'].map(v => <View key={v}>{button(suitName[v] || (v === 'all' ? 'All' : 'Man'), () => setSuit(v), false, suit === v)}</View>)}</View>}
                  {own?.route === 'unqualified' && <View style={s.builder}>
                    <Text style={s.heading}>Build your melds</Text>
                    {button('Select cards for meld', () => { setSelectingMeld(true); setSelected([]); setToolsOpen(false); cards.setOpen(true); }, busy)}
                    {suggestions && <View style={s.builder}>
                      <Text style={s.text}>{suggestions.dublees.length || suggestions.normal.length ? 'Possible declarations found. Choose a route to review before showing.' : `Found ${suggestions.pairCount} pairs. No complete declaration yet.`}</Text>
                      {!!suggestions.dublees.length && button('Review seven Dublees', () => { setGroups(suggestions.dublees); setSelected([]); setToolsOpen(false); setPreview(true); }, busy)}
                      {!!suggestions.normal.length && button('Review three melds', () => { setGroups(suggestions.normal); setSelected([]); setToolsOpen(false); setPreview(true); }, busy)}
                    </View>}<Text style={s.small}>Choose Select cards for meld to select multiple cards, then return here to choose a group type and add it. Submit seven Dublees or three sequences / Tunnelas together.</Text>
                    <View style={s.row}>{(['dublee', 'pure_sequence', 'tunnela'] as const).map(type => <View key={type}>{button(type === 'pure_sequence' ? 'Sequence' : type === 'dublee' ? 'Dublee' : 'Tunnela', () => setKind(type), false, kind === type)}</View>)}</View>
                    <View style={s.row}>{button('Check selected meld', () => cards.act('VALIDATE_MELD', { meld: selectedMeld }), !canAct || selected.length < 2)}
                      {button(`Add group · ${selected.length} cards`, () => { setGroups(g => [...g, selectedMeld]); setSelected([]); setSelectingMeld(false); }, selected.length < 2 || busy)}
                      {button('Clear selection', () => setSelected([]), !selected.length)}</View>
                    {snapshot.query_result?.command === 'VALIDATE_MELD' && snapshot.query_result.command_id === snapshot.action_ack?.command_id && <Text accessibilityLiveRegion="polite" style={s.success}>The selected meld is valid.</Text>}
                    {groups.map((group, i) => <View key={i} style={s.row}><Text style={[s.text, { flex: 1 }]}>{i + 1}. {group.meld_type.replace('_', ' ')} · {group.card_ids.map(physicalLabel).join('  ')}</Text>
                      {button(`Remove group ${i + 1}`, () => setGroups(g => g.filter((_, n) => n !== i)))}</View>)}
                    {button(declaration === 'SHOW_DUBLEES' ? 'Show seven Dublees' : 'Show three melds', () => declaration && cards.act(declaration, declaration === 'SHOW_DUBLEES' ? { pairs: groups } : { melds: groups }),
                      !canAct || !declaration || !actions?.kinds.includes(declaration.toLowerCase()))}
                  </View>}
                </>}
                <View style={s.maal}><Text style={s.heading}>Maal</Text><Text style={s.text}>{mine.maal ? `Tiplu ${marriageFace(mine.maal.tiplu)} · Jhiplu ${marriageFace(mine.maal.jhiplu)} · Poplu ${marriageFace(mine.maal.poplu)}` : 'Hidden until your melds qualify.'}</Text></View>
              </>}
            </View>}
          {!!error && <Text accessibilityRole="alert" style={s.error}>{error}</Text>}
        </ScrollView>
      </View></View>
    </Modal>
    <Modal transparent visible={finishPreview && !!normalFinish && !hidden && allRevealed && activeGame} animationType="none" onRequestClose={() => setFinishPreview(false)}>
      <View style={s.previewBackdrop}><View accessibilityViewIsModal testID="marriage-finish-preview" style={s.previewPanel}>
        <View style={s.row}><Text accessibilityRole="header" style={[s.heading, { flex: 1 }]}>Your winning hand</Text>{button('Close winning preview', () => setFinishPreview(false))}</View>
        <ScrollView contentContainerStyle={{ gap: 14 }}>
          <Text style={s.small}>Only you can see this preview. Finishing shows these 21 cards, discards the remaining card, and calculates points.</Text>
          {!!normalFinish && <><MarriageMeldCards groups={normalFinish.melds} />
            <Text style={s.text}>Final discard: {physicalLabel(normalFinish.discard_card_id)}</Text></>}
          {!!error && <Text accessibilityRole="alert" style={s.error}>{error}</Text>}
          {button('Confirm finish', () => cards.act('FINISH'), !canAct || !actions?.kinds.includes('finish'))}
        </ScrollView>
      </View></View>
    </Modal>
    <Modal transparent visible={!ended && preview} animationType="none" onRequestClose={() => setPreview(false)}>
      <View style={s.previewBackdrop}><View accessibilityViewIsModal testID="marriage-meld-preview" style={s.previewPanel}>
        <View style={s.row}><Text accessibilityRole="header" style={[s.heading, { flex: 1 }]}>Your declaration</Text>{button('Close preview', () => setPreview(false))}</View>
        <ScrollView contentContainerStyle={{ gap: 14 }}>
          <Text style={s.small}>Only you can see this preview. Show these groups to reveal them to everyone.</Text>
          <MarriageMeldCards groups={groups} />
          {!!error && <Text accessibilityRole="alert" style={s.error}>{error}</Text>}
          {button(declaration === 'SHOW_DUBLEES' ? 'Show seven Dublees' : 'Show three melds', () => declaration && cards.act(declaration, declaration === 'SHOW_DUBLEES' ? { pairs: groups } : { melds: groups }),
            !canAct || !declaration || !actions?.kinds.includes(declaration.toLowerCase()))}
          {!actions?.kinds.includes(declaration?.toLowerCase() || '') && <Text style={s.small}>You can show after drawing on your turn.</Text>}
        </ScrollView>
      </View></View>
    </Modal>
    <MarriageDetails busy={busy} error={error} onSave={onSave} snapshot={snapshot} section={details} onClose={() => setDetails(null)} />
    {!ended && poke !== undefined && <PokeComposer recipient={poke} recipientName={snapshot.players?.find(p => p.player_id === poke)?.display_name} connected={social.connected} phrases={social.phrases} onSave={social.save}
      onSend={text => social.send(poke, text)} onClose={() => setPoke(undefined)} />}
  </View>;
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  shownOverlay: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, zIndex: 60, alignItems: 'center', justifyContent: 'center', padding: 16 },
  shownCards: { width: '100%', maxWidth: 620, maxHeight: '85%', padding: 14, gap: 12, backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.cardBorder, overflow: 'hidden' },
  previewBackdrop: { flex: 1, backgroundColor: colors.overlay, padding: 20, justifyContent: 'center', alignItems: 'center' },
  previewPanel: { width: '100%', maxWidth: 640, maxHeight: '90%', backgroundColor: colors.surface, borderRadius: 16, padding: 16, gap: 16 },
  playArea: { backgroundColor: colors.table, flex: 1, minHeight: 0, padding: 8, gap: 6 }, handDock: { flexShrink: 0, padding: 12, gap: 6, backgroundColor: colors.surface, borderTopWidth: 1, borderColor: colors.tableTrim, borderTopLeftRadius: 20, borderTopRightRadius: 20 },
  page: { flex: 1, minHeight: 0, backgroundColor: colors.background }, header: { padding: 12, gap: 8, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' },
  title: { flex: 1, minWidth: 140, color: colors.accent, fontFamily: fonts.medium, fontSize: 18 }, content: { padding: 12, gap: 12, paddingBottom: 30 },
  columns: { flex: 1, minHeight: 0 }, main: { flex: 1, minHeight: 0, minWidth: 0 }, panel: { backgroundColor: colors.surface, borderRadius: 14, padding: 14, gap: 12 },
  table: { flex: 1, minHeight: 0, padding: 4, gap: 4 },
  seats: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, seat: { flexGrow: 1, flexBasis: 130, minWidth: 0, padding: 10, borderRadius: 10, borderWidth: 1, borderColor: colors.border, gap: 5 }, activeSeat: { borderColor: colors.turnText, borderWidth: 2 },
  player: { fontFamily: fonts.medium, color: colors.text, fontSize: 16 }, text: { fontFamily: fonts.body, color: colors.text, fontSize: 13, lineHeight: 21 },
  small: { fontFamily: fonts.body, color: colors.textMuted, fontSize: 12, lineHeight: 19 }, heading: { fontFamily: fonts.medium, color: colors.accent, fontSize: 16 },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 }, button: { minHeight: 44, backgroundColor: colors.surfaceRaised, borderRadius: 8, padding: 10, alignItems: 'center', justifyContent: 'center' },
  chosen: { backgroundColor: colors.surfaceSelected }, buttonText: { fontFamily: fonts.medium, color: colors.text, fontSize: 12 }, disabled: { opacity: 0.42 },
  piles: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 24, minHeight: 130 }, pileFace: { fontSize: 32, backgroundColor: colors.cardFace, color: colors.cardRed, borderRadius: 8, padding: 14 },
  hand: { flexDirection: 'row', flexWrap: 'wrap', gap: 5, position: 'relative', paddingVertical: 6 }, card: { width: 49, height: 78, borderRadius: 7, borderWidth: 2, borderColor: colors.cardBorder, backgroundColor: colors.cardFace, alignItems: 'center', justifyContent: 'center', gap: 3 },
  drawnCard: { borderColor: colors.accent, borderWidth: 3 },
  cardBack: { backgroundColor: colors.cardBack, borderColor: colors.cardBorder }, selectedCard: { borderColor: colors.cardSelectedBorder, borderWidth: 3, backgroundColor: colors.cardSelected }, face: { fontFamily: fonts.medium, fontSize: 23, fontWeight: 'bold' }, copy: { color: colors.cardInk, textAlign: 'center', fontSize: 8 },
  builder: { gap: 10, paddingTop: 12, borderTopWidth: 1, borderColor: colors.border }, maal: { backgroundColor: colors.surface, padding: 12, gap: 8, borderRadius: 8 },
  error: { color: colors.danger, backgroundColor: colors.dangerSurface, padding: 14, borderRadius: 10 }, success: { color: colors.success, fontSize: 13 },
});
