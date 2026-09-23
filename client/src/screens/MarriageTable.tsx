import { MarriageFinishTool } from '../components/MarriageFinishTool';
import { MarriageMaalPanel } from '../components/MarriageMaalPanel';
import { arrangeMarriageHand, type MarriageArrangement } from '../multiplayer/marriageArrangement';
import { MarriageAnnouncements } from '../components/MarriageAnnouncements';
import { PreGameTable } from '../components/PreGameTable';
import { MarriageRoundResults } from '../components/MarriageScoring';
import { useTableSocial } from '../components/TableSocial';
import { TurnIndicator } from '../components/TurnIndicator';
import { EndedTableNotice } from '../components/EndedTableNotice';
import { GameMenu, GameMenuMetadata } from '../components/GameMenu';
import { GameTableHeader } from '../components/GameTableHeader';
import { MarriageHandSheet } from '../components/MarriageHandSheet';
import { dubleeFinishProgress } from '../multiplayer/marriageFinishProgress';
import { marriageDecision, marriageHandSnap, type HandSnap } from '../multiplayer/marriageWorkspace';
import { TableStartCue } from '../components/TableStartCue';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { fonts, gameButtonStyle, useTheme, useThemedStyles, type ThemeColors } from '../theme';
import { useMarriageReveal } from '../multiplayer/useMarriageReveal';
import { MarriageCardArea } from '../components/MarriageCardArea';
import { MarriageMeldCards } from '../components/MarriageMeldCards';
import { MarriageCardBack } from '../components/MarriageCardBack';
import { MarriageDetails } from '../components/MarriagePlayers';
import { PokeComposer } from '../components/PokeComposer';
import type { PlayerPhrase } from '../multiplayer/pokes';
import type { RoomSnapshot } from './LiveGameTable';
import { marriageFace, physicalLabel } from '../multiplayer/marriage';

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
  const [arrangement, setArrangement] = useState<MarriageArrangement>('sequence');
  const [hidden, setHidden] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [preview, setPreview] = useState(false);
  const [finishToolsOpen, setFinishToolsOpen] = useState(false);
  const [finishPreview, setFinishPreview] = useState(false);
  const handAnchor = useRef<View>(null);
  const tableSocial = useTableSocial();
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
  }, [handKey]);
  useEffect(() => {
    if (own?.route && own.route !== 'unqualified') { setPreview(false); }
  }, [own?.route]);
  const allRevealed = revealed >= 21;
  const availableHand = hand.filter(c => !committed.includes(c.card_id));
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
    setSelected([]);
  }, [decision, snapshot.match_id, mine?.player_id]);
  const cards = {
    open: snap !== 'collapsed',
    setOpen: (open: boolean) => setSnap(open ? 'expanded' : 'collapsed'),
    act: onAction,
  };
  const normalFinish = actions?.normal_finish;
  const eighthPair = useMemo(() => own?.route === 'dublee' ? dubleeFinishProgress(hand, own.shown_melds).pairs[0] : undefined, [handKey, own?.route]);
  useEffect(() => {
    if (!activeGame || (!normalFinish && !eighthPair) || hidden || !allRevealed) setFinishPreview(false);
  }, [activeGame, normalFinish, eighthPair, hidden, allRevealed]);
  useEffect(() => { setFinishPreview(false); setFinishToolsOpen(false); setPreview(false); }, [snapshot.match_id, mine?.player_id]);
  function button(label: string, action: () => void, disabled = false, chosen = false) {
    const primary = /^(Finish round|Confirm finish|Show three melds|Show seven Dublees)$/.test(label);
    return <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled}
      accessibilityState={{ disabled, selected: chosen }} onPress={action} style={({ pressed }) => [s.button, gameButtonStyle(colors, primary ? 'primary' : 'secondary', pressed), chosen && s.chosen, disabled && s.disabled]}>
      <Text style={[s.buttonText, primary && { color: colors.onPrimary }]}>{label}</Text></Pressable>;
  }
  const handGroups = allRevealed && !hidden ? arrangeMarriageHand(availableHand, arrangement) : [{label:'', cards:availableHand}];
  const drawnId = drawnCard?.card_id;
  const startCue = ended ? endedNotice : <TableStartCue snapshot={snapshot} busy={busy} onStart={onStart} onTableAction={onTableAction} onNewGame={onNewGame} />;
  const canDiscard = canAct && isTurn && !!actions?.kinds.includes('discard');
  const discardSelected = selected.length === 1 && !!actions?.discardable_card_ids.includes(selected[0]);
  const selectedCard = discardSelected ? hand.find(card => card.card_id === selected[0]) : null;
  const turnInstruction = decision === 'DRAW_REQUIRED' ? 'Your turn · Draw'
    : decision === 'DISCARD_REQUIRED' ? 'Your turn · Discard'
    : decision === 'FINISH_REQUIRED' ? 'Your turn · Finish round' : `Your cards · ${hand.length}`;
  const turnPrompt = activeGame && pub && <TurnIndicator testID="marriage-turn-instruction" personal={isTurn}
    text={isTurn && decision !== 'WAITING' ? turnInstruction : `${name(pub.current_player_id)}’s turn`} />;
  const mobileHandHeader = <View testID="marriage-hand-header" style={{ backgroundColor: colors.surface, paddingHorizontal: 10, gap: 4 }}>
    {!mobile && turnPrompt}
    {actions?.kinds.includes('finish') && button('Finish round', () => setFinishPreview(true), !canAct)}
    {!!error && !selectedCard && <Text accessibilityRole="alert" style={s.error}>{error}</Text>}
  </View>;
  const discardFooter = selectedCard && <>
    {!!error && <Text accessibilityRole="alert" style={[s.small, { color: colors.danger }]}>{error}</Text>}
    <Pressable testID="marriage-discard-action" accessibilityRole="button" accessibilityLabel={`Discard ${physicalLabel(selectedCard.card_id)}`}
      disabled={!canDiscard} accessibilityState={{ disabled: !canDiscard }} onPress={() => cards.act('DISCARD_CARD', { card_id: selectedCard.card_id })}
      style={({ pressed }) => [s.button, gameButtonStyle(colors, 'primary', pressed), !canDiscard && s.disabled]}><Text style={[s.buttonText, { color: colors.onPrimary }]}>{busy ? 'Sending…' : `Discard ${marriageFace(selectedCard)}`}</Text></Pressable>
  </>;
  useEffect(() => {
    if (error && !busy && selectedCard && decision === 'DISCARD_REQUIRED') setSnap('expanded');
  }, [error, busy, selectedCard?.card_id, decision]);
  return <View style={s.page} testID="marriage-table">
    <GameTableHeader tableName={snapshot.table_name} compact title="Marriage" path={snapshot.path} game="marriage" roomId={snapshot.room_id} matchId={snapshot.match_id} onBack={onBack}
      drawerMetadata={<GameMenuMetadata snapshot={snapshot} />}>
      {close => <GameMenu snapshot={snapshot} close={close} back={onBack} tableControl={tableControl} leaveControl={lobbyControl} endControl={endControl}
        poke={() => setPoke(null)} pokePlayer={setPoke} canPoke={social.connected}
        gameActions={(['stats', 'rules', 'points'] as const).map(section => ({ label: section === 'stats' ? 'Stats' : section === 'rules' ? 'Rules' : 'Points', action: () => setDetails(section) }))} />}
    </GameTableHeader>
    {activeGame && allRevealed && !hidden && own?.has_seen_maal && mine?.maal && (own.route === 'normal' || own.route === 'dublee') && <MarriageFinishTool
      hand={hand} shown={own.shown_melds} maal={mine.maal} route={own.route} topDiscard={pub?.top_discard}
      canTakeDiscard={canAct && !!actions?.drawable_sources.includes('discard')} canFinish={canAct && !!actions?.kinds.includes('finish')}
      busy={busy} open={finishToolsOpen} setOpen={setFinishToolsOpen} onReview={() => setFinishPreview(true)} />}
    <View style={{ flex: 1, minHeight: 0 }}>
    <View testID="marriage-play-area" style={[s.playArea, mobile && mine && activeGame && { paddingBottom: 64 }]}>
      {ended && !pub ? <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>{endedNotice}</View> : !pub ? <ScrollView contentContainerStyle={s.panel}>
        <PreGameTable snapshot={snapshot}>{startCue}</PreGameTable>
        {!snapshot.is_creator && <Text style={s.text}>Waiting for the creator to start.</Text>}
      </ScrollView> : <>
        {snapshot.status === 'finished' && <ScrollView style={{ maxHeight: '60%', flexShrink: 1 }} contentContainerStyle={s.panel}><MarriageRoundResults snapshot={snapshot} /><Text accessibilityRole="header" style={s.heading}>{name(pub.winner)} wins!</Text>
          <Text style={s.text}>{pub.normal_finish ? 'Normal hand complete.' : 'Eight Dublees complete.'} Ready for another round?</Text>
          {startCue}</ScrollView>}
        <View style={s.columns}>
          <View style={s.main}>
            <View style={s.table}>
              <MarriageAnnouncements key={snapshot.match_id} snapshot={snapshot} />
              <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center' }}><MarriageCardArea snapshot={snapshot} handAnchor={handAnchor} canAct={!busy && activeGame} onAction={cards.act} onPoke={activeGame || ended ? undefined : setPoke} /></ScrollView>
              <View style={tableSocial?.canRead ? { marginBottom: 60 } : undefined}>{!isTurn && turnPrompt}</View>
              {ended && <View testID="ended-table-overlay" style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, alignItems: 'center', justifyContent: 'center', zIndex: 70 }}>{endedNotice}</View>}

            </View>

          </View>
        </View>
      </>}
      {!!error && (!mine || !activeGame || (mobile && snap === 'collapsed')) && <Text accessibilityRole="alert" style={s.error}>{error}</Text>}
    </View>
    {pub && mine && activeGame && <MarriageHandSheet cardCount={hand.length} anchor={handAnchor} mobile={mobile} snap={snap} onSnap={setSnap} instruction={turnInstruction} attention={isTurn} header={mobileHandHeader} footer={preview ? null : discardFooter}>
    <View testID="marriage-hand-dock" style={[s.handDock, mobile && { backgroundColor: 'transparent', borderTopWidth: 0, padding: 4 }]}>
      <View style={[s.row, { backgroundColor: colors.tableHeader, borderRadius: 8 }]}><Text style={[s.small, { color: colors.onTableHeader }]}>Your cards · {hand.length}</Text>
        {!allRevealed && button('Reveal cards', () => reveal(true), busy)}
        {allRevealed && button(hidden ? 'Show cards' : 'Hide cards', () => { setHidden(v => !v); setSelected([]); setPreview(false); })}
      </View>

      <MarriageMaalPanel hand={availableHand} shown={own?.shown_melds || []} unlocked={!!own?.has_seen_maal} maal={mine.maal}
        enabled={canAct && isTurn && social.connected} visible={allRevealed && !hidden} busy={busy} actions={actions?.kinds || []}
        preview={preview && !hidden} setPreview={setPreview} arrangement={arrangement} error={error} submit={onAction} />
      {!preview && <>
        {allRevealed && <View accessibilityRole="tablist" style={s.row}>
          {(['sequence','dublee'] as const).map(value=><Pressable key={value} accessibilityRole="tab" accessibilityLabel={value==='sequence'?'Sequence / Tunnela':'Dublee'}
            accessibilityState={{selected:arrangement===value}} onPress={()=>setArrangement(value)} style={[s.button,arrangement===value&&s.chosen]}>
            <Text style={s.buttonText}>{value==='sequence'?'Sequence / Tunnela':'Dublee'}</Text>
          </Pressable>)}
        </View>}
        {!hidden && allRevealed && drawnCard && <Text testID="marriage-drawn-card" accessibilityLiveRegion="polite" style={s.heading}>You drew {physicalLabel(drawnCard.card_id)}</Text>}
        <View testID="marriage-hand" style={{gap:10}}>
          {handGroups.map(group=><View key={group.cards[0]?.card_id || 'empty'} style={{gap:4}}>
            {!!group.label&&<Text style={s.small}>{group.label}</Text>}
            <View style={{flexDirection:'row',flexWrap:'wrap',gap:5}}>
              {group.cards.map((card,index)=>{
                const back=hidden||(!allRevealed&&index>=revealed), checked=selected.includes(card.card_id);
                return <Pressable key={card.card_id} accessibilityRole="button" accessibilityLabel={back?'Hidden card':physicalLabel(card.card_id)}
                  accessibilityHint={!back&&card.card_id===drawnId?'Just drawn':undefined} aria-pressed={checked}
                  accessibilityState={{selected:checked,disabled:busy||back}} disabled={busy||back}
                  onPress={()=>setSelected(ids=>ids.length===1&&ids[0]===card.card_id?[]:[card.card_id])}
                  style={[s.card, {width:48,height:76},back&&s.cardBack,!back&&card.card_id===drawnId&&s.drawnCard,checked&&s.selectedCard]}>
                  {back?<MarriageCardBack/>:<Text style={[s.face,{fontSize:21,color:card.suit==='H'||card.suit==='D'?colors.cardRed:colors.cardInk}]}>{marriageFace(card)}</Text>}
                  {!back&&card.card_id===drawnId&&<Text style={{fontSize:9,color:colors.cardInk}}>NEW</Text>}
                  {!back&&<Text style={s.copy}>{card.card_type==='man'?'Man':`Copy ${(card.deck_index??0)+1}`}</Text>}
                </Pressable>;
              })}
            </View>
          </View>)}
        </View>
        {own?.has_seen_maal && <View style={s.row}>{button('Plan winning hand',()=>setFinishToolsOpen(true))}</View>}
      </>}
    </View></MarriageHandSheet>}
    </View>
    <Modal transparent visible={finishPreview && (!!normalFinish || !!eighthPair) && !hidden && allRevealed && activeGame} animationType="none" onRequestClose={() => setFinishPreview(false)}>
      <View style={s.previewBackdrop}><View accessibilityViewIsModal testID="marriage-finish-preview" style={s.previewPanel}>
        <View style={s.row}><Text accessibilityRole="header" style={[s.heading, { flex: 1 }]}>Your winning hand</Text>{button('Close winning preview', () => setFinishPreview(false))}</View>
        <ScrollView contentContainerStyle={{ gap: 14 }}>
          <Text style={s.small}>{eighthPair ? 'Only you can see this preview. Finishing reveals your eighth natural pair to everyone and calculates points.' : 'Only you can see this preview. Finishing shows these 21 cards, discards the remaining card, and calculates points.'}</Text>
          {!!eighthPair && <><Text style={s.heading}>Eighth Dublee</Text><MarriageMeldCards groups={[eighthPair]} />
            <Text style={s.heading}>Seven locked pairs</Text><MarriageMeldCards groups={own?.shown_melds || []} /></>}
          {!!normalFinish && <><MarriageMeldCards groups={normalFinish.melds} />
            <Text style={s.text}>Final discard: {physicalLabel(normalFinish.discard_card_id)}</Text></>}
          {!!error && <Text accessibilityRole="alert" style={s.error}>{error}</Text>}
          {button('Confirm finish', () => cards.act('FINISH'), !canAct || !actions?.kinds.includes('finish'))}
        </ScrollView>
      </View></View>
    </Modal>
    <MarriageDetails busy={busy} error={error} onSave={onSave} snapshot={snapshot} section={details} onClose={() => setDetails(null)} />
    {!ended && poke !== undefined && <PokeComposer recipient={poke} recipientName={snapshot.players?.find(p => p.player_id === poke)?.display_name} connected={social.connected} phrases={social.phrases} onSave={social.save}
      onSend={text => social.send(poke, text)} onClose={() => setPoke(undefined)} />}
  </View>;
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
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
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 }, button: { ...gameButtonStyle(colors), alignItems: 'center', justifyContent: 'center' },
  chosen: { backgroundColor: colors.surfaceSelected }, buttonText: { fontFamily: fonts.medium, color: colors.onTableHeader, fontSize: 12 }, disabled: { opacity: 0.42 },
  piles: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 24, minHeight: 130 }, pileFace: { fontSize: 32, backgroundColor: colors.cardFace, color: colors.cardRed, borderRadius: 8, padding: 14 },
  hand: { flexDirection: 'row', flexWrap: 'wrap', gap: 5, position: 'relative', paddingVertical: 6 }, card: { width: 49, height: 78, borderRadius: 7, borderWidth: 2, borderColor: colors.cardBorder, backgroundColor: colors.cardFace, alignItems: 'center', justifyContent: 'center', gap: 3 },
  drawnCard: { borderColor: colors.accent, borderWidth: 3 },
  cardBack: { backgroundColor: colors.cardBack, borderColor: colors.cardBorder }, selectedCard: { borderColor: colors.cardSelectedBorder, borderWidth: 3, backgroundColor: colors.cardSelected }, face: { fontFamily: fonts.medium, fontSize: 23, fontWeight: 'bold' }, copy: { color: colors.cardInk, textAlign: 'center', fontSize: 8 },
  builder: { gap: 10, paddingTop: 12, borderTopWidth: 1, borderColor: colors.border }, maal: { backgroundColor: colors.surface, padding: 12, gap: 8, borderRadius: 8 },
  error: { color: colors.danger, backgroundColor: colors.dangerSurface, padding: 14, borderRadius: 10 }, success: { color: colors.success, fontSize: 13 },
});
