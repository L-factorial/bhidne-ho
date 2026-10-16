import { FittedGameTable } from '../components/FittedGameTable';
import { MarriageMeldCards } from '../components/MarriageMeldCards';
import { WaitingHandArea } from '../components/WaitingHandArea';
import { ThemeBackdrop } from '../components/ThemeBackdrop';
import {CompactCardFace} from '../components/CompactCardFace';
import { RoomSheet } from '../components/RoomSheet';
import {AppText as Text} from '../components/AppText';
import { gameAttention } from '../notifications/gameAttention';
import { ui, uiLabel } from '../i18n/copy.ts';
import { useUiLanguage } from '../i18n/useUiLanguage';
import { MarriageTunnelaPanel } from '../components/MarriageTunnelaPanel';
import { showTableHeaderShare } from '../multiplayer/tableHeaderSharing';
import { TurnGlow } from '../components/TurnGlow';
import { MarriageWinPanel } from '../components/MarriageWinPanel';
import { MarriageMaalPanel } from '../components/MarriageMaalPanel';
import { arrangeMarriageHand, type MarriageArrangement } from '../multiplayer/marriageArrangement';
import { MarriageAnnouncements } from '../components/MarriageAnnouncements';
import { PreGameTable } from '../components/PreGameTable';
import { useTableSocial } from '../components/TableSocial';
import { TurnIndicator } from '../components/TurnIndicator';
import { EndedTableNotice } from '../components/EndedTableNotice';
import { GameMenu, GameMenuMetadata } from '../components/GameMenu';
import { GameTableHeader } from '../components/GameTableHeader';
import { MarriageHandSheet } from '../components/MarriageHandSheet';
import { marriageDecision, marriageHandSnap, type HandSnap } from '../multiplayer/marriageWorkspace';
import { TableStartCue } from '../components/TableStartCue';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import {Pressable, ScrollView, StyleSheet, Text as TabText, View, useWindowDimensions} from 'react-native';
import { visualStates, radii, fonts, gameButtonStyle, useTheme, useThemedStyles, type ThemeColors } from '../theme';
import { useMarriageReveal } from '../multiplayer/useMarriageReveal';
import { MarriageCardArea } from '../components/MarriageCardArea';
import { MarriageCardBack } from '../components/MarriageCardBack';
import { MarriageHandCard } from '../components/MarriageHandCard';
import { cardDropTarget, marriageCardMarker, reconcileHandOrder, insertHandCardBefore, type CardBounds } from '../multiplayer/marriageHandOrder';
import { GameRules } from '../components/GameRules';
import { MarriageDetails } from '../components/MarriagePlayers';
import { PokeComposer } from '../components/PokeComposer';
import type { PlayerPhrase } from '../multiplayer/pokes';
import type { RoomSnapshot } from './LiveGameTable';
import { GameStats, useGameStats } from '../components/GameStats';
import { marriageFace, physicalLabel } from '../multiplayer/marriage';

export function MarriageTable({ snapshot, busy, error, onAction, onStart, onBack, onNewGame, onSave, endControl, lobbyControl, social, tableControl, onTableAction }: {
  tableControl?: ReactNode; onTableAction: (command: string) => void;
  onSave: (rules: import('../multiplayer/marriage').MarriageScoringRules) => void;
  snapshot: RoomSnapshot; busy: boolean; error: string; endControl?: ReactNode; lobbyControl?: ReactNode;
  onAction: (command: string, payload?: object) => void; onStart: () => void; onBack: () => void; onNewGame: () => void;
  social: { connected: boolean; phrases: PlayerPhrase[]; save: (text: string) => Promise<void>; send: (recipient: number | null, text: string) => Promise<void> };
}) {
  useUiLanguage();
  const { colors } = useTheme();
  const ended = snapshot.status === 'ended';
  const endedNotice = <EndedTableNotice onBack={onBack} onNewGame={onNewGame} />;
  const s = useThemedStyles(createStyles);
  const mobile = useWindowDimensions().width < 900;
  const stats = useGameStats(snapshot.match_id, snapshot.your_player_id);
  const [collapsedHandHeight, setCollapsedHandHeight] = useState(90);
  const [arrangement, setArrangement] = useState<MarriageArrangement | "personal">("personal");
  const [manualOrder,setManualOrder] = useState<{key:string;ids:string[]}>({key:'',ids:[]});
  const [handWidth,setHandWidth] = useState(0);
  const [draggingCard,setDraggingCard] = useState(false);
  const cardNodes = useRef(new Map<string,View>());
  const registerCard = useCallback((id:string,node:View|null)=>{
    if(node)cardNodes.current.set(id,node);else cardNodes.current.delete(id);
  },[]);
  const [shownSection, setShownSection] = useState<'sequence'|'dublee'|'tunnela'|null>(null);
  const [confirmFold, setConfirmFold] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [preview, setPreview] = useState(false);
  const [finishPreview, setFinishPreview] = useState(false);
  const handAnchor = useRef<View>(null);
  const tableSocial = useTableSocial();
  const [rulesOpen, setRulesOpen] = useState(false);
  const [details, setDetails] = useState<'stats' | 'config' | 'points' | null>(null);
  const [poke, setPoke] = useState<number | null | undefined>(undefined);
  const pub = snapshot.marriage?.public, mine = snapshot.marriage?.private;
  const hand = mine?.hand || [], actions = mine?.actions;
  // Start face up; Hide remains a local privacy choice.
  const { revealed, reveal } = useMarriageReveal(snapshot.match_id, mine?.player_id, true);
  const own = pub?.players.find(p => p.player_id === mine?.player_id);
  const recordedTunnelas = [...new Map([...(own?.initial_tunnelas || []), ...(own?.shown_melds.filter(meld => meld.meld_type==='tunnela') || [])]
    .map(meld => [meld.card_ids.slice().sort().join(','), meld])).values()];
  const maalKey = `${snapshot.match_id}:${mine?.player_id}:${mine?.maal?.tiplu.rank}:${mine?.maal?.tiplu.suit}`;
  const [seenMaal, setSeenMaal] = useState('');
  const [flippedMaal, setFlippedMaal] = useState('');
  const seeMaal = !!own?.has_seen_maal && !!mine?.maal && snapshot.status === 'playing' && seenMaal !== maalKey;

  const committed = own?.shown_melds.flatMap(m => m.card_ids) || [];
  const handKey = hand.map(c => c.card_id).join(',') + committed.join(',');
  useEffect(() => {
    const available = hand.filter(c => !committed.includes(c.card_id)).map(c => c.card_id);
    setSelected(current => current.filter(id => available.includes(id)));
  }, [handKey]);
  useEffect(() => {
    if (own?.route && own.route !== 'unqualified') { setPreview(false); }
  }, [own?.route]);
  useEffect(() => {
    if (own?.folded || snapshot.status !== 'playing') setConfirmFold(false);
    if (own?.folded) { setSelected([]); setPreview(false); setFinishPreview(false); }
  }, [own?.folded, snapshot.status]);
  const declaring = !!actions?.kinds.includes('declare_tunnelas');
  const declarationsPending = !!pub?.tunnela_declaration_pending;
  const allRevealed = revealed >= 21;
  const availableHand = hand.filter(c => !committed.includes(c.card_id));
  const canAct = !own?.folded && !busy && !hidden && allRevealed && snapshot.status === 'playing';
  const name = (id: string | null) => snapshot.players?.find(p => String(p.player_id) === id)?.display_name || ui("common.player_number", { "number": id });
  const isTurn = !!mine && mine.player_id === pub?.current_player_id;
  // The private hand preserves receipt order; draws append, even after reconnecting.
  const drawnCard = isTurn && pub?.phase === 'must_discard' ? hand.at(-1) : undefined;
  const activeGame = snapshot.status === 'playing';
  const decision = marriageDecision(snapshot.marriage, activeGame);
  const detectionKey=JSON.stringify([snapshot.match_id,hand.map(c=>c.card_id),own?.shown_melds,own?.route,mine?.maal,declaring,own?.folded,own?.has_seen_maal,allRevealed,hidden]);
  const [localMarriage,setLocalMarriage]=useState({key:'',ready:false});
  const [localMaal,setLocalMaal]=useState({key:'',ready:false});
  const [localTunnela,setLocalTunnela]=useState({key:'',ready:false});
  const reportMarriage=useCallback((ready:boolean)=>setLocalMarriage({key:detectionKey,ready}),[detectionKey]);
  const reportMaal=useCallback((ready:boolean)=>setLocalMaal({key:detectionKey,ready}),[detectionKey]);
  const reportTunnela=useCallback((ready:boolean)=>setLocalTunnela({key:detectionKey,ready}),[detectionKey]);
  const handCue=gameAttention(snapshot,{
    marriage:localMarriage.key===detectionKey&&localMarriage.ready,
    maal:localMaal.key===detectionKey&&localMaal.ready,
    tunnela:localTunnela.key===detectionKey&&localTunnela.ready,
  });
  useEffect(()=>{if(own?.route && own.route!=='unqualified'){setPreview(false);}},[own?.route]);
  const [snap, setSnap] = useState<HandSnap>(() => marriageHandSnap(decision));
  // Only a new decision changes the sheet; polling, selecting and showing melds do not.
  useEffect(() => {
    setSnap(stats.open ? 'collapsed' : preview || finishPreview ? 'expanded' : marriageHandSnap(decision));
    setSelected([]);
  }, [decision, snapshot.match_id, mine?.player_id]);
  const cards = {
    open: snap !== 'collapsed',
    setOpen: (open: boolean) => setSnap(open ? 'expanded' : 'collapsed'),
    act: onAction,
  };
  useEffect(() => { if (!activeGame || hidden || !allRevealed) setFinishPreview(false); }, [activeGame, hidden, allRevealed]);
  useEffect(() => { setFinishPreview(false); setPreview(false); }, [snapshot.match_id, mine?.player_id]);
  function button(label: string, action: () => void, disabled = false, chosen = false, primary = false, compact = false) {
    return <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled}
      accessibilityState={{ disabled, selected: chosen }} onPress={action} style={({ pressed }) => [s.button, gameButtonStyle(colors, primary ? 'primary' : 'secondary', pressed), chosen && s.chosen, disabled && s.disabled, compact && {minWidth:0,minHeight:50,maxWidth:'100%',flex:1,paddingHorizontal:8}]}>
      <Text style={[s.buttonText, primary && { color: colors.onPrimary },compact && {fontSize:14,textAlign:'center',flexShrink:1}]} >{label}</Text></Pressable>;
  }
  const postMaal = !!own?.has_seen_maal;
  const manualView = postMaal || arrangement === "personal";
  const handGroups = allRevealed && !hidden && (postMaal || arrangement !== "personal") ? arrangeMarriageHand(availableHand, postMaal ? "sequence" : arrangement as MarriageArrangement) : [{label:'', cards:availableHand}];
  const orderKey = JSON.stringify([snapshot.match_id,mine?.player_id,postMaal]);
  useEffect(()=>{
    setManualOrder(current=>current.key===orderKey?current:{key:orderKey,ids:postMaal?handGroups.flatMap(group=>group.cards).map(card=>card.card_id):[]});
  },[orderKey]);
  useEffect(()=>{setArrangement('personal');},[snapshot.match_id,mine?.player_id]);
  const dragStateKey = JSON.stringify([orderKey,handKey,hidden,allRevealed,declaring,busy,manualView]);
  const currentDragState = useRef(dragStateKey);
  currentDragState.current = dragStateKey;
  const displayedHand = reconcileHandOrder(handGroups.flatMap(group=>group.cards),
    manualView && allRevealed && !hidden && manualOrder.key===orderKey ? manualOrder.ids : []);
  async function dropCard(source:string,x:number,y:number) {
    if(busy || hidden || !allRevealed || declaring || !manualView)return;
    const bounds = await Promise.all([...cardNodes.current].map(([id,node])=>new Promise<CardBounds>(resolve=>
      node.measureInWindow((x,y,width,height)=>resolve({id,x,y,width,height})))));
    if(currentDragState.current!==dragStateKey)return;
    const target=cardDropTarget(bounds,source,x,y);
    if(target)setManualOrder(current=>({key:orderKey,ids:insertHandCardBefore(
      reconcileHandOrder(displayedHand,current.key===orderKey?current.ids:[]).map(card=>card.card_id),source,target)}));
  }
  const cardWidth = mobile && handWidth ? (handWidth - 7 * 5) / 8 : 48;
  const unseenWinReady = !postMaal && localMarriage.key===detectionKey && localMarriage.ready;
  const handActions = <View testID="marriage-hand-actions" style={{flexDirection:'row',gap:5,alignItems:'center',justifyContent:'center',width:availableHand.length===21?cardWidth*3+10:'100%',minHeight:76}}>
    {!own?.folded && button(ui('marriage.fold'),()=>setConfirmFold(true),busy||!social.connected||!actions?.kinds.includes('fold'),false,false,true)}
    {allRevealed ? button(hidden?ui('common.show_cards'):ui('common.hide_cards'),()=>{setHidden(v=>!v);setSelected([]);setPreview(false);setFinishPreview(false);},false,false,false,true) : button(ui('common.reveal_cards'),()=>reveal(true),busy,false,false,true)}
    {unseenWinReady && button(ui('marriage.win_without_maal'),()=>setFinishPreview(true),busy,false,false,true)}
    {!!own?.folded && <Text style={s.small}>{ui('marriage.folded_watching_this_round')}</Text>}
  </View>;
  const drawnId = drawnCard?.card_id;
  const startCue = ended ? endedNotice : <TableStartCue snapshot={snapshot} busy={busy} onStart={onStart} onTableAction={onTableAction} onNewGame={onNewGame} />;
  const canDiscard = canAct && isTurn && social.connected && !!actions?.kinds.includes('discard');
  const drawVisible = !own?.folded && decision === 'DRAW_REQUIRED';
  const canDrawFrom = (source: string) => drawVisible && !busy && social.connected && !!actions?.drawable_sources.includes(source);
  const discardSelected = selected.length === 1 && !!actions?.discardable_card_ids.includes(selected[0]);
  const selectedCard = discardSelected ? hand.find(card => card.card_id === selected[0]) : null;
  const turnInstruction = declaring ? ui("marriage.declare_your_initial_tunnelas") : declarationsPending ? ui("marriage.waiting_for_tunnela_declarations") : decision === 'DRAW_REQUIRED' ? localMaal.key===detectionKey&&localMaal.ready&&actions?.kinds.includes('show_initial_melds') ? ui('marriage.show_then_draw') : ui("marriage.your_turn_draw_a_card")
    : decision === 'DISCARD_REQUIRED' ? selectedCard ? ui("marriage.your_turn_confirm_discard") : ui("marriage.your_turn_select_a_card_to_discard")
    : decision === 'FINISH_REQUIRED' ? ui("marriage.your_turn_finish_round") : ui("common.your_cards_status", { "status": hand.length });
  const turnPrompt = activeGame && pub && <TurnIndicator testID="marriage-turn-instruction" personal={isTurn}
    announcementOnly={!isTurn || decision === 'WAITING'}
    text={isTurn && decision !== 'WAITING' ? turnInstruction : ui("common.player_s_turn", { "player": name(pub.current_player_id) })} />;
  const mobileHandHeader = <View testID="marriage-hand-header" style={{ backgroundColor: colors.surface, paddingHorizontal: 10, gap: 4 }}>
    {!!error && !selectedCard && <Text activity accessibilityRole="alert" style={s.error}>{uiLabel(error, 'feedback')}</Text>}
  </View>;
  const discardFooter = selectedCard && <>
    {!!error && <Text activity accessibilityRole="alert" style={[s.small, { color: colors.danger }]}>{uiLabel(error, 'feedback')}</Text>}
    <Pressable testID="marriage-discard-action" accessibilityRole="button" accessibilityLabel={ui("marriage.discard_card", { "card": physicalLabel(selectedCard.card_id) })}
      disabled={!canDiscard} accessibilityState={{ disabled: !canDiscard }} onPress={() => cards.act('DISCARD_CARD', { card_id: selectedCard.card_id })}
      style={({ pressed }) => [s.button, gameButtonStyle(colors, 'primary', pressed), !canDiscard && s.disabled]}><Text activity style={[s.buttonText, { color: colors.onPrimary }]}>{busy ? ui("social.sending") : ui("marriage.discard_card", { "card": marriageFace(selectedCard) })}</Text></Pressable>
  </>;
  useEffect(() => {
    if (!stats.open && error && !busy && selectedCard && decision === 'DISCARD_REQUIRED') setSnap('expanded');
  }, [error, busy, selectedCard?.card_id, decision]);
  const recordedDeclarations = <View testID="marriage-recorded-declarations" style={[s.row,{minWidth:0,flex:1,alignItems:'stretch',flexWrap:'nowrap'}]}>
    {own?.route==='normal' && !!own.shown_melds.length && button(ui('marriage.view_shown_sequence'),()=>setShownSection('sequence'),false,false,false,true)}
    {own?.route==='dublee' && !!own.shown_melds.length && button(ui('marriage.view_shown_dublee'),()=>setShownSection('dublee'),false,false,false,true)}
    {!!recordedTunnelas.length && button(ui('marriage.view_shown_tunnela'),()=>setShownSection('tunnela'),false,false,false,true)}
  </View>;
  return <View style={s.page} testID="marriage-table">
    <ThemeBackdrop />
    <GameTableHeader showShare={showTableHeaderShare(snapshot)} tableName={snapshot.table_name} compact title={ui("rooms.marriage")} path={snapshot.path} game="marriage" roomId={snapshot.room_id} matchId={snapshot.match_id} onBack={onBack}
      drawerMetadata={<GameMenuMetadata snapshot={snapshot} />}>
      {close => <GameMenu snapshot={snapshot} close={close} back={onBack} tableControl={tableControl} leaveControl={lobbyControl} endControl={endControl}
        poke={() => setPoke(null)} pokePlayer={setPoke} canPoke={social.connected}
        rules={() => setRulesOpen(true)} rulesConfig={() => setDetails('config')}
        gameActions={[{ label: ui('marriage.points'), action: () => setDetails('points') }]} />}
    </GameTableHeader>
    <View style={{ flex: 1, minHeight: 0 }}>
    <RoomSheet visible={shownSection!==null} presentation="dialog" title={ui(shownSection==='dublee'?'marriage.dublee':shownSection==='tunnela'?'marriage.tunnela':'marriage.sequence')} onClose={()=>setShownSection(null)} testID="marriage-own-shown-cards">
      <MarriageMeldCards groups={shownSection==='tunnela'?recordedTunnelas:own?.shown_melds||[]}/>
    </RoomSheet>
    <RoomSheet visible={seeMaal} presentation="dialog" testID="marriage-see-maal-step" title={ui('marriage.see_maal_step')} closeLabel={ui('marriage.see_maal_step')} onClose={() => { if (flippedMaal === maalKey) setSeenMaal(maalKey); }}>
      <Text style={s.text}>{ui('marriage.see_maal_help')}</Text>
      <Pressable testID="marriage-see-maal-card" accessibilityRole="button" accessibilityLabel={ui(flippedMaal === maalKey ? 'marriage.tap_to_hide_the_maal' : 'marriage.tap_to_see_the_maal')} onPress={() => setFlippedMaal(flippedMaal === maalKey ? '' : maalKey)} style={[s.card, { width: 72, height: 104, alignSelf: 'center' }]}>
        {flippedMaal === maalKey && mine?.maal ? <CompactCardFace rank={mine.maal.tiplu.rank} suit={mine.maal.tiplu.suit} /> : <MarriageCardBack />}
      </Pressable>
      {button(ui('common.continue'), () => setSeenMaal(maalKey), flippedMaal !== maalKey)}
    </RoomSheet>
    <View testID="marriage-play-area" style={[s.playArea, mine && (activeGame || snapshot.status==='finished') && { paddingBottom: collapsedHandHeight + 12 }]}>
      <GameStats snapshot={snapshot} open={stats.open} onOpen={() => { setSnap('collapsed'); stats.show(); }} onClose={stats.close}>
      {ended && !pub ? <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>{endedNotice}</View> : !pub ? <FittedGameTable testID="marriage-waiting-viewport">
        <PreGameTable fill snapshot={snapshot}>{startCue}</PreGameTable>
      </FittedGameTable> : <>
        <View style={s.columns}>
          <View style={s.main}>
            <View style={s.table}>
              {snapshot.status!=='finished' && <MarriageAnnouncements key={snapshot.match_id} snapshot={snapshot} suspended={stats.open} />}
              <FittedGameTable testID="marriage-play-viewport"><MarriageCardArea snapshot={snapshot} maalFaceUp={flippedMaal === maalKey} onToggleMaal={() => setFlippedMaal(value => value === maalKey ? '' : maalKey)} onResult={() => setDetails("points")} handAnchor={handAnchor} canAct={!busy && social.connected && activeGame} onAction={cards.act} onPoke={activeGame || ended ? undefined : setPoke} /></FittedGameTable>
              {!isTurn && turnPrompt && <View style={{position:'absolute',bottom:8,left:0,right:0,alignItems:'center'}}>{turnPrompt}</View>}
              {ended && <View testID="ended-table-overlay" style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, alignItems: 'center', justifyContent: 'center', zIndex: 70 }}>{endedNotice}</View>}

            </View>

          </View>
        </View>
      </>}
      {!!error && (!mine || !activeGame || (mobile && snap === 'collapsed')) && <Text activity accessibilityRole="alert" style={s.error}>{uiLabel(error, 'feedback')}</Text>}
      </GameStats>
    </View>
    {!ended && snapshot.your_player_id && !(pub && mine && activeGame) && (snapshot.status==='finished'?<View style={{position:'absolute',bottom:0,left:0,right:0}}><WaitingHandArea/></View>:<WaitingHandArea/>)}
    {pub && mine && activeGame && <MarriageHandSheet preview={!!preview || !!finishPreview} onCollapsedHeight={setCollapsedHandHeight} draggingCard={draggingCard} cue={handCue} cardCount={hand.length} anchor={handAnchor} mobile={mobile} snap={stats.open ? 'collapsed' : snap} onSnap={next => { if (next !== 'collapsed') stats.close(); setSnap(next); }} statusText={declaring?turnInstruction:isTurn&&handCue?`${ui('common.attention_turn')} — ${ui(decision==='DRAW_REQUIRED'?'common.attention_draw':decision==='DISCARD_REQUIRED'?'marriage.discard_action':handCue.detail)}`:ui('common.player_s_turn',{player:name(pub.current_player_id)})} instruction={turnInstruction} attention={declaring || isTurn && !declarationsPending} header={mobileHandHeader} footer={own?.folded || preview || finishPreview ? null : discardFooter}>
    <View testID="marriage-hand-dock" style={[s.handDock, mobile && { backgroundColor: 'transparent', borderTopWidth: 0, padding: 4 }]}>
        {(!mobile || snap === 'expanded') && <View testID="marriage-hand-draw" style={s.drawSection}>
          {(['discard', 'stock'] as const).map(source => {
            const allowed = canDrawFrom(source);
            const label = source === 'discard' ? ui("marriage.tap_to_take_from_discard") : ui("marriage.tap_to_take_from_deck");
            const card = pub.top_discard;
            return <View key={source} style={s.drawSource}>
              <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{disabled: !allowed}}
                disabled={!allowed} onPress={() => cards.act('DRAW_CARD', {source})}
                style={[s.card, {width:58,height:84}, source === 'stock' && s.cardBack, !allowed && s.disabled]}>
                {source === 'stock' ? <MarriageCardBack/> : card ? <CompactCardFace rank={card.rank} suit={card.suit} joker={card.rank === null}/> : <Text style={s.face}>—</Text>}
                <TurnGlow active={allowed} radius={7}/>
              </Pressable>
              <Text style={s.small}>{source === 'discard' ? ui("marriage.discard_pile") : ui("marriage.deck_count", { "count": pub.stock_count })}</Text>


            </View>;
          })}
          <View style={s.drawSource}>
            <Pressable testID="marriage-hand-maal" accessibilityRole="button" accessibilityLabel={ui(pub.maal_selected===false?'marriage.maal_empty':flippedMaal===maalKey?'marriage.tap_to_hide_the_maal':'marriage.tap_to_see_the_maal')}
              disabled={!mine.maal} accessibilityState={{disabled:!mine.maal,expanded:!!mine.maal&&flippedMaal===maalKey}} onPress={()=>setFlippedMaal(value=>value===maalKey?'':maalKey)} style={[s.card,{width:58,height:84},pub.maal_selected===false&&{backgroundColor:colors.surface,borderStyle:'dashed'},!mine.maal&&s.disabled]}>
              {mine.maal&&flippedMaal===maalKey?<CompactCardFace rank={mine.maal.tiplu.rank} suit={mine.maal.tiplu.suit}/>:pub.maal_selected===false?null:<MarriageCardBack/>}
            </Pressable>
            <Text style={s.small}>{ui('marriage.maal')}</Text>
          </View>
        </View>}

      {!own?.has_seen_maal && recordedDeclarations}
      {confirmFold && !own?.folded && <View style={s.panel}>
        <Text style={s.text}>{ui("marriage.fold_help")}</Text>
        <View style={s.row}>{button(ui("marriage.confirm_fold"), () => { onAction('FOLD'); }, busy || !social.connected || !actions?.kinds.includes('fold'))}
          {button(ui("common.keep_playing"), () => setConfirmFold(false), busy)}</View>
      </View>}
      {declaring && <MarriageTunnelaPanel onEligibility={reportTunnela} hand={hand} visible={allRevealed&&!hidden} busy={busy} connected={social.connected} submit={onAction}/>}
      {declarationsPending && !declaring && <Text style={s.text}>{ui("marriage.declaration_recorded_waiting_for_other_players")}</Text>}
      <View testID="marriage-hand-controls" style={{display:!preview&&!finishPreview&&!(postMaal?localMarriage.key===detectionKey&&localMarriage.ready:localMaal.key===detectionKey&&localMaal.ready)?'none':'flex',flexDirection:preview||finishPreview?'column':'row',gap:6,alignItems:'stretch'}}>
        <View style={{flex:preview||finishPreview?undefined:2,minWidth:0,gap:6,flexDirection:preview||finishPreview?'column':'row'}}>{!declaring&&!own?.folded&&<>
          {!postMaal&&!finishPreview&&<MarriageMaalPanel handAnchor={handAnchor} onEligibility={reportMaal} hand={availableHand} shown={own?.shown_melds||[]} unlocked={false} maal={null}
            playerCount={pub.players.length} enabled={canAct&&isTurn&&social.connected} visible={allRevealed&&!hidden} busy={busy} actions={actions?.kinds||[]}
            preview={preview&&!hidden} setPreview={setPreview} arrangement={arrangement==="personal"?"sequence":arrangement} error={uiLabel(error,'feedback')} submit={onAction}/>}
          {!preview&&<MarriageWinPanel hideIndicator={!postMaal} onEligibility={reportMarriage} hand={hand} shown={own?.shown_melds||[]} initialTunnelas={own?.initial_tunnelas} maal={mine.maal} route={own?.route||'unqualified'} playerCount={pub.players.length}
            visible={allRevealed&&!hidden} enabled={canAct&&isTurn&&social.connected} busy={busy} canFinish={!!actions?.kinds.includes('finish')}
            preview={finishPreview&&!hidden} setPreview={setFinishPreview} error={uiLabel(error,'feedback')} submit={onAction}/>}
        </>}</View>
      </View>
      {!preview && !finishPreview && <>
        {postMaal && recordedDeclarations}
        {!postMaal && !declaring && allRevealed && <View accessibilityRole="tablist" testID="marriage-view-tabs" style={{flexDirection:'row',gap:4}}>
          {(["personal","sequence","dublee"] as const).filter(value=>value!=='dublee'||pub.players.length>=4).map(value=>{
            const label=ui(value==='personal'?'marriage.my_arrangement':'marriage.auto_arrangement');
            const subtitle=value==='personal'?undefined:ui(value==='sequence'?'marriage.sequence_tunnela':'marriage.dublee');
            return <Pressable key={value} accessibilityRole="tab" accessibilityLabel={subtitle?`${label} — ${subtitle}`:label} accessibilityState={{selected:arrangement===value}} aria-selected={arrangement===value} onPress={()=>setArrangement(value)} style={[s.button,{flex:1,minWidth:0,height:44,minHeight:44,paddingHorizontal:4,paddingVertical:4,justifyContent:'center',alignItems:'center'},arrangement===value&&s.chosen]}>
              <TabText numberOfLines={1} adjustsFontSizeToFit style={[s.buttonText,{fontSize:12,lineHeight:16,textAlign:'center'}]}>{label}</TabText>
              {!!subtitle&&<TabText numberOfLines={1} adjustsFontSizeToFit style={[s.buttonText,{fontSize:10,lineHeight:14,textAlign:'center',opacity:0.65}]}>{subtitle}</TabText>}
            </Pressable>;
          })}
        </View>}
        <View style={{position:'relative',borderRadius: radii.medium}}>
        <View testID="marriage-hand" onLayout={event=>{const width=event.nativeEvent.layout.width;setHandWidth(width);}} style={{flexDirection:'row',flexWrap:'wrap',gap:5,width:'100%',maxWidth:mobile?undefined:419,alignSelf:'center'}}>
              {displayedHand.map((card,index)=>{
                const back=hidden||(!allRevealed&&index>=revealed), checked=selected.includes(card.card_id);
                const marker=back?null:marriageCardMarker(card.card_id===drawnId,checked);
                return <MarriageHandCard key={card.card_id} id={card.card_id} label={back?ui("common.hidden_card"):physicalLabel(card.card_id)}
                  wrapperStyle={{width:cardWidth}} hint={!back&&card.card_id===drawnId?ui("marriage.just_drawn"):undefined} selected={checked}
                  disabled={busy||back||declaring} dragDisabled={!allRevealed||!manualView} register={registerCard} onDragChange={setDraggingCard} onDrop={(id,x,y)=>void dropCard(id,x,y)}
                  onPress={()=>setSelected(ids=>ids.length===1&&ids[0]===card.card_id?[]:[card.card_id])}
                  style={[s.card, {width:cardWidth,height:76},back&&s.cardBack,!back&&card.card_id===drawnId&&s.drawnCard,checked&&s.selectedCard]}>
                  {!!marker&&<Text pointerEvents="none" testID={`marriage-card-marker-${marker}`} style={{position:'absolute',top:-17,fontSize:18,lineHeight:18,fontWeight:'bold',color:marker==='discard'?'#DC2626':'#15803D'}}>▼</Text>}
                  {back?<MarriageCardBack/>:<CompactCardFace rank={card.rank} suit={card.suit} joker={card.card_type==='man'}/>}
                </MarriageHandCard>;
              })}
          {handActions}
        </View>
        <TurnGlow active={canDiscard} radius={8}/>
        </View>
      </>}
    </View></MarriageHandSheet>}
    </View>
    <GameRules snapshot={snapshot} visible={rulesOpen} onClose={() => setRulesOpen(false)} />
    <MarriageDetails busy={busy} error={uiLabel(error, 'feedback')} onSave={onSave} snapshot={snapshot} section={details} onClose={() => setDetails(null)} />
    {!ended && poke !== undefined && <PokeComposer recipient={poke} recipientName={snapshot.players?.find(p => p.player_id === poke)?.display_name} connected={social.connected} phrases={social.phrases} onSave={social.save}
      onSend={text => social.send(poke, text)} onClose={() => setPoke(undefined)} />}
  </View>;
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  previewBackdrop: { flex: 1, backgroundColor: colors.overlay, padding: 20, justifyContent: 'center', alignItems: 'center' },
  previewPanel: { width: '100%', maxWidth: 640, maxHeight: '90%', backgroundColor: colors.surface, borderRadius: 16, padding: 16, gap: 16 },
  playArea: { flex: 1, minHeight: 0, gap: 0 }, handDock: { flexShrink: 0, padding: 12, gap: 6, backgroundColor: colors.surface, borderTopWidth: 1, borderColor: colors.tableTrim, borderTopLeftRadius: 20, borderTopRightRadius: 20 },
  page: { flex: 1, minHeight: 0, backgroundColor: colors.background }, header: { padding: 12, gap: 8, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' },
  title: { flex: 1, minWidth: 140, color: colors.accent, fontFamily: fonts.medium, fontSize: 18 }, content: { padding: 12, gap: 12, paddingBottom: 30 },
  columns: { flex: 1, minHeight: 0 }, main: { flex: 1, minHeight: 0, minWidth: 0 }, panel: { backgroundColor: colors.surface, borderRadius: radii.large, padding: 14, gap: 12 },
  table: { flex: 1, minHeight: 0, gap: 0 },
  seats: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, seat: { flexGrow: 1, flexBasis: 130, minWidth: 0, padding: 10, borderRadius: radii.medium, borderWidth: 1, borderColor: colors.border, gap: 5 }, activeSeat: { borderColor: colors.turnText, borderWidth: 2 },
  player: { fontFamily: fonts.medium, color: colors.text, fontSize: 16 }, text: { fontFamily: fonts.body, color: colors.text, fontSize: 13, lineHeight: 21 },
  small: { fontFamily: fonts.body, color: colors.textMuted, fontSize: 12, lineHeight: 19 }, heading: { fontFamily: fonts.medium, color: colors.accent, fontSize: 16 },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 }, button: { ...gameButtonStyle(colors), alignItems: 'center', justifyContent: 'center' },
  chosen: { backgroundColor: colors.surfaceSelected }, buttonText: { fontFamily: fonts.medium, color: colors.onTableHeader, fontSize: 12 }, disabled: { opacity: visualStates.disabledOpacity },
  drawSection: { flexDirection:'row', flexWrap:'wrap', alignItems:'flex-start', gap:8, justifyContent:'center', padding:6, borderWidth:1, borderColor:colors.border, borderRadius: radii.medium, backgroundColor:colors.tableHeader },
  drawSource: { flex:1, alignItems:'center', gap:2 },
  piles: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 24, minHeight: 130 }, pileFace: { fontSize: 32, backgroundColor: colors.cardFace, color: colors.cardRed, borderRadius: radii.medium, padding: 14 },
  hand: { flexDirection: 'row', flexWrap: 'wrap', gap: 5, position: 'relative', paddingVertical: 6 }, card: { width: 49, height: 78, borderRadius: 7, borderWidth: 2, borderColor: colors.cardBorder, backgroundColor: colors.cardFace, alignItems: 'center', justifyContent: 'center', gap: 3 },
  drawnCard: { borderColor: '#15803D', borderWidth: 4 },
  cardBack: { backgroundColor: colors.cardBack, borderColor: colors.cardBorder }, selectedCard: { borderColor: '#DC2626', borderWidth: 4, backgroundColor: colors.cardSelected }, face: { fontFamily: fonts.medium, fontSize: 23, fontWeight: 'bold' }, copy: { color: colors.cardInk, textAlign: 'center', fontSize: 8 },
  builder: { gap: 10, paddingTop: 12, borderTopWidth: 1, borderColor: colors.border }, maal: { backgroundColor: colors.surface, padding: 12, gap: 8, borderRadius: radii.medium },
  error: { color: colors.danger, backgroundColor: colors.dangerSurface, padding: 14, borderRadius: radii.medium }, success: { color: colors.success, fontSize: 13 },
});
