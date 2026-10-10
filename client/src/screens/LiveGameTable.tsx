import { WaitingHandArea } from '../components/WaitingHandArea';
import {AppText as Text} from '../components/AppText';
import { gameAttention } from '../notifications/gameAttention';
import { playerError } from '../multiplayer/playerError.ts';
import { ui, uiLabel } from '../i18n/copy.ts';
import { useUiLanguage } from '../i18n/useUiLanguage';
import { showTableHeaderShare } from '../multiplayer/tableHeaderSharing';
import { FloatingTableAction } from '../components/FloatingTableAction';
import { PreGameTable } from '../components/PreGameTable';
import { EndedTableNotice } from '../components/EndedTableNotice';
import { GameMenu, GameMenuMetadata } from '../components/GameMenu';
import { ActionCue } from '../components/ActionCue';
import type { RuleProposalView } from '../components/RuleProposal';
import { GameTableHeader } from '../components/GameTableHeader';
import { MobileGameHand } from '../components/MobileGameHand';
import { TableStartCue } from '../components/TableStartCue';
import { useCallBreakHand } from '../multiplayer/useCallBreakHand';
import { type ReactNode, useEffect, useState } from 'react';
import {Pressable, ScrollView, StyleSheet, View, useWindowDimensions} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CallBreakSummary } from '../components/CallBreakSummary';
import { CardTable } from '../components/CardTable';
import { GameRules } from '../components/GameRules';
import { GameStats, useGameStats } from '../components/GameStats';
import { callBreakPreviousStats } from '../multiplayer/gameStats';
import { PlayerHand, type HandView } from '../components/PlayerHand';
import { LiveBidPrompt } from '../components/LiveBidPrompt';
import { GameDetails } from '../components/GameDetails';
import { RoundSummary } from '../components/RoundSummary';
import { radii, fonts, gameButtonStyle, useTheme, useThemedStyles, type ThemeColors } from '../theme';
import type { ActionAck } from '../multiplayer/PendingGameAction';
import type { PlayerPhrase } from '../multiplayer/pokes';
import { PokeComposer } from '../components/PokeComposer';
import { DealerSelectionTable } from '../components/DealerSelectionTable';

export type PlayMode = 'manual';

type Trick = { trick_number: number; plays: { player_id: number; card: string }[]; complete: boolean; winner?: number };
export type RoomSnapshot = {
  session?: import('../multiplayer/tableSession').TableSession;
  card_theme?: string; can_change_card_theme?: boolean; card_theme_controller_id?: string | null;
  rule_proposal?: RuleProposalView | null; chat_enabled?: boolean;
  room_id?: string; table_name?: string; path?: string;
  tables?: import('../multiplayer/tableNavigation').TableSummary[];
  can_create_new_game?: boolean; can_end_table?: boolean;
  roster_open?: boolean;
  table?: import('../components/TableControls').TableView;
  marriage_scoring?: import('../multiplayer/marriage').MarriageScoringRules;
  marriage_scoring_presets?: Record<string, import('../multiplayer/marriage').MarriageScoringRules>;
  game_type?: 'callbreak' | 'marriage' | 'flush';
  flush_settings?: import('../multiplayer/flush').FlushSettings;
  flush?: import('../multiplayer/flush').FlushView;
  marriage?: import('../multiplayer/marriage').MarriageView;
  query_result?: { command: string; command_id: string; result: unknown } | null;
  action_ack?: ActionAck;
  round_review?: { deal_number: number; can_continue: boolean };
  table_id?:string;table_revision?:number;durable_game_id?:string|null;
  status: 'empty' | 'waiting' | 'playing' | 'finished' | 'ended'; match_id?: string; capacity?: number;
  players?: { player_id: number; user_id: string; display_name?: string; avatar_url?: string; connected?: boolean | null }[]; your_player_id?: number | null; can_join?: boolean;
  play_mode?: PlayMode; remaining_ms?: number | null; error?: string | null;
  game?: { revision: number; hand_review_phase_id?: string | null; phase: string; finished: boolean; winners: number[]; turn: { player_id: number | null };
    dealer_selection?: { complete: boolean; current_player: number | null; dealer: number | null;
      available_positions: number[]; picks: { player_id: number; position: number; card: string }[] } | null;
    current_trick: Trick | null; scores_tenths: number[]; score_scale?: number; win_reason?: 'instant_bid' | 'perfect_bid' | 'score' | null };
  deal?: { attempt?: number; deal_number: number; dealer: number; tricks_completed: number; tricks_required: number; tricks: Trick[];
    players: { player_id: number; bid: number | null; tricks_won: number; cards_remaining: number }[] };
  private?: { hand: string[]; legal_cards: string[]; can_accept_hand: boolean; can_claim_redeal: boolean } | null;
  is_creator?: boolean; ready?: boolean;
  settings?: { weak_hand_enabled: boolean; minimum_face_card?: 'ANY' | 'JACK' | 'QUEEN'; no_spades_enabled: boolean; payments: number[]; match_rules?: import('../multiplayer/callbreakRules').CallBreakMatchRules | null };
  deal_history?: { deal_number: number; complete: boolean; tricks?: Trick[]; players: { player_id: number; bid: number | null; tricks_won: number; score_tenths: number | null }[] }[];
  scoreboard?: { player_id: number; deal_scores_tenths: (number | null)[]; total_score_tenths: number; bonus_tricks?: number }[];
  player_stats?: { player_id: number; total_tricks_won: number }[];
  rules?: { bid_max: number };
  log?: { event: string; revision: number; player_id?: number; action?: string }[];
};
const suits: Record<string, string> = { S: '♠', H: '♥', D: '♦', C: '♣' };
const face = (card: string) => card.slice(0, -1) + suits[card.slice(-1)];

export function LiveGameTable({ snapshot, busy, error, onAction, onBack, onStart, onSave, onNewGame, onNextDeal, social, endControl, tableControl, lobbyControl, onTableAction }: {
  tableControl?: ReactNode; onTableAction: (command: string) => void;
  endControl?: ReactNode; lobbyControl?: ReactNode;
  social: { connected: boolean; phrases: PlayerPhrase[]; save: (text: string) => Promise<void>; send: (recipient: number | null, text: string) => Promise<void> };
  onNextDeal: () => void; onNewGame: () => void; onStart: () => void; onSave: (settings: NonNullable<RoomSnapshot['settings']>) => void;
  snapshot: RoomSnapshot; busy: boolean; error: string; onAction: (command: string, payload?: object) => void; onBack: () => void;
}) {
  useUiLanguage();
  const { colors } = useTheme();
  const ended = snapshot.status === 'ended';
  const endedNotice = <EndedTableNotice onBack={onBack} onNewGame={onNewGame} />;
  const styles = useThemedStyles(createStyles);
  const insets = useSafeAreaInsets();
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const wide = screenWidth >= 1000;
  const mobile = screenWidth < 900;
  const [tableWidth, setTableWidth] = useState(280);
  const [tableHeight, setTableHeight] = useState(400);
  const width = Math.max(180, Math.min(Math.min(tableWidth, screenWidth) - 24, 800));
  const [revealedDeal, setRevealedDeal] = useState<string | null>(null);
  const handDealKey = `${snapshot.match_id}:${snapshot.deal?.deal_number}:${snapshot.deal?.attempt}`;
  const [expandedLastTrick, setExpandedLastTrick] = useState<string | null>(null);
  const [draggingCard, setDraggingCard] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);
  const [handView, setHandView] = useState<HandView>("fan");
  const [collapsedHandHeight, setCollapsedHandHeight] = useState(93);
  const [pokeTarget, setPokeTarget] = useState<number | null | undefined>(undefined);
  const [pokeNotice, setPokeNotice] = useState<{ player: string | null; at: number } | null>(null);
  useEffect(() => {
    if (!pokeNotice) return;
    const timer = setTimeout(() => setPokeNotice(null), 2500);
    return () => clearTimeout(timer);
  }, [pokeNotice]);
  const completedTrick = [...(snapshot.deal?.tricks || [])].reverse().find(t => t.complete);
  const trickKey = completedTrick ? `${snapshot.match_id}:${snapshot.deal?.deal_number}:${snapshot.deal?.attempt}:${completedTrick.trick_number}` : '';
  const [hiddenTrick, setHiddenTrick] = useState('');
  const [collectingTrick, setCollectingTrick] = useState('');
  useEffect(() => {
    const gather = setTimeout(() => setCollectingTrick(trickKey), 1500);
    const timer = setTimeout(() => setHiddenTrick(trickKey), 2200);
    return () => { clearTimeout(gather); clearTimeout(timer); };
  }, [trickKey]);
  const reveal = !!trickKey && hiddenTrick !== trickKey && !snapshot.game?.current_trick?.plays.length;
  const playerName = (id: number) => snapshot.players?.find(p => p.player_id === id)?.display_name || ui("common.player_number", { "number": id });
  const game = snapshot.game, deal = snapshot.deal, mine = snapshot.private;
  const stats = useGameStats(snapshot.match_id, snapshot.your_player_id);
  const isTurn = !ended && !!snapshot.your_player_id && game?.turn.player_id === snapshot.your_player_id;
  const handAvailable = !ended && !!mine && mine.hand.length > 0 && !game?.finished && !snapshot.round_review;
  const promptKey = handAvailable && (isTurn || mine?.can_accept_hand)
    ? `${handDealKey}:${game?.phase}:${isTurn}:${game?.current_trick?.trick_number || deal?.tricks_completed || 0}` : null;
  const cards = useCallBreakHand({ deal: handDealKey, turn: !reveal && !busy ? promptKey : null,
    revision: game?.revision ?? 0, hand: mine?.hand ?? [], busy, error, keepCollapsed: stats.open }, onAction);
  const header = <GameTableHeader showShare={showTableHeaderShare(snapshot)} tableName={snapshot.table_name} compact game="callbreak" title={ui("rooms.call_break")} path={snapshot.path} roomId={snapshot.room_id} matchId={snapshot.match_id} onBack={onBack}
    drawerMetadata={<GameMenuMetadata snapshot={snapshot} />}>
    {close => <GameMenu snapshot={snapshot} close={close} back={onBack} tableControl={tableControl} leaveControl={lobbyControl} endControl={endControl}
      rules={() => setRulesOpen(true)} rulesConfig={() => setConfigOpen(true)} poke={() => setPokeTarget(null)} pokePlayer={setPokeTarget} canPoke={social.connected} />}
  </GameTableHeader>;
  const gameRules = <><GameRules snapshot={snapshot} visible={rulesOpen} onClose={() => setRulesOpen(false)} /><GameDetails configOpen={configOpen} onCloseConfig={() => setConfigOpen(false)} snapshot={snapshot} busy={busy} onSave={onSave} menu /></>;
  const socialOverlay = !ended && pokeTarget !== undefined && <PokeComposer recipient={pokeTarget} recipientName={snapshot.players?.find(p => p.player_id === pokeTarget)?.display_name} phrases={social.phrases} connected={social.connected}
    onClose={() => setPokeTarget(undefined)} onSave={social.save} onSend={async text => {
      await social.send(pokeTarget, text);
      setPokeNotice({ player: pokeTarget === null ? null : playerName(pokeTarget), at: Date.now() });
    }} />;
  const startCue = ended ? endedNotice : <TableStartCue snapshot={snapshot} busy={busy} onStart={onStart} onTableAction={onTableAction} onNewGame={onNewGame} />;
  if (!ended && game?.phase === 'SELECTING_DEALER' && game.dealer_selection) return <View style={styles.page}>
    {header}{gameRules}<GameStats snapshot={snapshot} open={stats.open} onOpen={stats.show} onClose={stats.close}><View style={{ flex:1, minHeight:0 }}>
      <DealerSelectionTable snapshot={snapshot} busy={busy} onPick={position => onAction('PICK_DEALER_CARD', { position })} />
      {!!error && <Text accessibilityRole="alert" style={styles.error}>{uiLabel(error, 'feedback')}</Text>}
    </View></GameStats>{socialOverlay}
  </View>;
  if (ended && (!game || !deal)) return <View style={styles.page}>{header}{gameRules}<GameStats snapshot={snapshot} open={stats.open} onOpen={stats.show} onClose={stats.close}><View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>{endedNotice}</View></GameStats></View>;
  if (!game || !deal) return <View style={styles.page}>
    {header}{gameRules}
    <GameStats snapshot={snapshot} open={stats.open} onOpen={stats.show} onClose={stats.close}><ScrollView contentContainerStyle={{ flexGrow: 1 }}>
      <PreGameTable fill snapshot={snapshot}>{startCue}</PreGameTable>
      {!!error && <Text accessibilityRole="alert" style={styles.error}>{uiLabel(error, 'feedback')}</Text>}
    </ScrollView></GameStats>{snapshot.your_player_id && <WaitingHandArea />}{socialOverlay}
  </View>;
  if (!ended && (snapshot.round_review || game.finished) && !reveal) return <View style={styles.page}>{header}{gameRules}<GameStats snapshot={snapshot} open={stats.open} onOpen={stats.show} onClose={stats.close}><RoundSummary
    snapshot={snapshot} busy={busy} error={error || (snapshot.error ? playerError(snapshot.error) : '')} onContinue={onNextDeal} onBack={onBack} onNewGame={onNewGame}
    hideNavigation controls={game.finished ? startCue : snapshot.round_review?.can_continue ? <View testID="callbreak-center-next-deal" style={{ minHeight: 160, alignItems: 'center', justifyContent: 'center' }}>
      <Pressable accessibilityRole="button" accessibilityLabel={ui("callbreak.start_next_deal")} disabled={busy} onPress={onNextDeal} style={styles.button}><ActionCue active={!busy} style={styles.buttonText}>{ui("callbreak.start_next_deal")}</ActionCue></Pressable>
    </View> : <Text style={styles.meta}>{ui("common.waiting_for_the_creator_to_start_the_next_deal")}</Text>} /></GameStats>{socialOverlay}</View>;
  const players = deal.players.map(player => ({ id: String(player.player_id), name: playerName(player.player_id),
    avatarUrl: snapshot.players?.find(p => p.player_id === player.player_id)?.avatar_url,
    connected: snapshot.players?.find(p => p.player_id === player.player_id)?.connected,
    ...callBreakPreviousStats(snapshot, player.player_id),
    bid: player.bid ?? 0, currentBid: player.bid, tricks: Math.max(0, player.tricks_won - (reveal && completedTrick?.winner === player.player_id ? 1 : 0)), cardsRemaining: player.cards_remaining }));
  const last = [...deal.tricks].reverse().find(trick => trick.complete);
  const trick = reveal ? completedTrick : game.current_trick;
  function action(label: string, command: string, payload = {}) {
    return <Pressable accessibilityRole="button" disabled={busy} accessibilityState={{ disabled: busy }} onPress={() => cards.act(command, payload)} style={styles.button}><ActionCue active={!busy} style={styles.buttonText}>{label}</ActionCue></Pressable>;
  }
  const preparation = isTurn && ['AWAITING_SHUFFLE', 'AWAITING_CUT', 'AWAITING_DISTRIBUTION'].includes(game.phase) ? <View testID="callbreak-center-preparation" style={{ gap: 8, alignItems: 'center' }}>
      {game.phase === 'AWAITING_SHUFFLE' && <FloatingTableAction label={ui("callbreak.shuffle_deck")} disabled={busy} onPress={() => cards.act('SHUFFLE_DECK')} />}
      {game.phase === 'AWAITING_CUT' && <>{<FloatingTableAction label={ui("callbreak.cut_in_half")} disabled={busy} onPress={() => cards.act('CUT_DECK', { position: 26 })} />}{<FloatingTableAction label={ui("callbreak.skip_cut")} disabled={busy} onPress={() => cards.act('SKIP_CUT')} />}</>}
      {game.phase === 'AWAITING_DISTRIBUTION' && <FloatingTableAction label={ui("callbreak.deal_cards")} disabled={busy} onPress={() => cards.act('START_DISTRIBUTION')} />}
    </View> : null;
  const showDealerNotice=game.phase==='AWAITING_SHUFFLE'&&deal.deal_number===1&&game.dealer_selection?.complete;
  return <View style={styles.page}>
    {header}{gameRules}

    <View style={[styles.workspace, wide && styles.wideBody]}>
    <View style={[styles.playColumn, wide && { alignSelf: 'stretch' }, handAvailable && { paddingBottom: collapsedHandHeight }]}>
    <View style={styles.body}>
    <GameStats snapshot={snapshot} open={stats.open} onOpen={() => { cards.collapse(); stats.show(); }} onClose={stats.close}>
    <ScrollView testID="callbreak-play-viewport" style={styles.tableScroll} onLayout={event => { setTableWidth(event.nativeEvent.layout.width); setTableHeight(event.nativeEvent.layout.height); }} contentContainerStyle={[styles.container, {
      paddingTop: 0, paddingBottom: 12,
    }]}><View style={{ width }}>
    {!!(error || snapshot.error) && <Text accessibilityRole="alert" style={styles.error}>{uiLabel(error || (snapshot.error ? playerError(snapshot.error) : ''), 'feedback')}</Text>}
    <CardTable height={tableHeight - 12} detailedStats centerStatus={<><Text numberOfLines={2} style={[styles.meta, { textAlign: 'center' }]}>{ui('callbreak.summary_round', { round: deal.deal_number, total: 5 })}{'\n'}{ui('callbreak.summary_hand', { hand: trick?.trick_number ?? Math.min(deal.tricks_completed + 1, deal.tricks_required), total: deal.tricks_required })}</Text><Text accessibilityLiveRegion="polite" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', opacity: 0 }}>{game.turn.player_id ? ui('common.player_s_turn', { player: playerName(game.turn.player_id) }) : ui('callbreak.current_trick')}</Text></>} showScores={game.phase === 'BIDDING' || game.phase === 'PLAYING'} compact={mobile && screenHeight < 760} centerControl={ended ? endedNotice : preparation || showDealerNotice ? <View style={{gap:8,alignItems:'center'}}>
        {showDealerNotice&&<Text accessibilityLiveRegion="polite" style={styles.meta}>{ui('callbreak.selected_dealer',{player:playerName(deal.dealer)})}</Text>}
        {preparation}
      </View> : null} width={width} players={players} dealerId={String(deal.dealer)} viewerId={snapshot.your_player_id ? String(snapshot.your_player_id) : ''}
      collectionKey={reveal ? trickKey : undefined} collecting={reveal && collectingTrick === trickKey}
      winnerPlayerId={reveal ? String(completedTrick?.winner) : undefined} activePlayerId={!ended && !reveal && game.turn.player_id ? String(game.turn.player_id) : ''} plays={(trick?.plays || []).map(play => ({ playerId: String(play.player_id), card: face(play.card) }))} />
    <View testID="central-turn-notice">
      {!ended && reveal && <Text accessibilityLiveRegion="polite" style={styles.status}>{ui("callbreak.player_wins_trick_number", { "player": playerName(completedTrick!.winner!), "number": completedTrick!.trick_number })}</Text>}
    </View>
    {!!pokeNotice && <Text accessibilityLiveRegion="polite" style={styles.meta}>{pokeNotice.player === null ? ui("social.sent_to_the_table") : ui("social.poke_sent_to_player", {player: pokeNotice.player})} ✦</Text>}

  </View></ScrollView>

    </GameStats></View>
    {last && !stats.open && (!mobile || !cards.open) && <View style={[styles.lastTrick]}>
      <Pressable accessibilityRole="button" accessibilityLabel={ui("callbreak.last_trick")} aria-expanded={expandedLastTrick === trickKey} accessibilityState={{ expanded: expandedLastTrick === trickKey }}
        onPress={() => setExpandedLastTrick(value => value === trickKey ? null : trickKey)} style={styles.lastToggle}>
        <Text style={styles.meta}>{ui("callbreak.last_trick_player_won", { "player": playerName(last.winner!) })}</Text><Text style={styles.link}>{expandedLastTrick === trickKey ? '-' : '+'}</Text>
      </Pressable>
      {expandedLastTrick === trickKey && <View testID="last-trick-cards" style={styles.lastCards}>
        {last.plays.map((play, index) => <View key={play.player_id} style={styles.lastPlayer}>
          <Text numberOfLines={1} style={styles.meta}>{playerName(play.player_id)}</Text>
          <View testID={play.player_id === last.winner ? 'last-trick-winner' : undefined} accessibilityLabel={ui("common.card_played", {player: playerName(play.player_id), card: face(play.card), lead: play.player_id === last.winner ? `, ${ui("marriage.winner")}` : ""})}
            style={[styles.lastCard, play.player_id === last.winner && styles.lastWinner]}>
            <Text style={[styles.lastFace, /[HD]$/.test(play.card) && { color: colors.cardRed }, play.card.endsWith('C') && { color: colors.cardClub }]}>{face(play.card)}</Text>
          </View>
          <Text style={styles.meta}>{play.player_id === last.winner ? ui("marriage.winner") : index === 0 ? ui("callbreak.led") : ui("callbreak.play_card", { "card": index + 1 })}</Text>
        </View>)}
      </View>}
    </View>}
    {handAvailable && <MobileGameHand draggingCard={draggingCard} cue={gameAttention(snapshot)} docked overlay onCollapsedHeight={setCollapsedHandHeight} desktopDrawer mobile={mobile} game="callbreak" keepMounted cardCount={mine?.hand.length || 0}
      open={cards.open} onToggle={() => { stats.close(); cards.toggle(); }} myTurn={isTurn}
      attention={isTurn || !!mine?.can_accept_hand || !!mine?.can_claim_redeal}
      attentionText={mine?.can_accept_hand || mine?.can_claim_redeal ? ui("callbreak.review_your_cards_accept_or_request_redeal") : isTurn ? game.phase === 'BIDDING' ? ui("callbreak.make_your_call") : ui("callbreak.play_a_card") : ui("common.your_cards_count", {count: mine?.hand.length || 0})}>
    <View testID="callbreak-hand-dock" style={[styles.handDock, mobile && { backgroundColor: 'transparent', borderTopWidth: 0, paddingHorizontal: 4 }]}><CallBreakSummary compact snapshot={{ ...snapshot, game: { ...game, current_trick: trick ?? null } }} />
    {game.phase === 'PLAYING' && !deal.tricks.some(trick => trick.complete || trick.plays.length) && !game.current_trick?.plays.length && <Text accessibilityLiveRegion="polite" style={styles.status}>{ui("callbreak.bidding_complete_message", { "message": isTurn ? ui("callbreak.you_lead_first") : ui("common.leads_first", {player: playerName(game.turn.player_id!)}) })}</Text>}
    {game.phase === 'BIDDING' && <LiveBidPrompt key={`${snapshot.match_id}-${deal.deal_number}-${deal.attempt}`} snapshot={snapshot} revealed={revealedDeal === handDealKey} busy={busy} onAction={cards.act} />}

    {(mine?.can_accept_hand || mine?.can_claim_redeal) && <View style={styles.actions}>{mine?.can_accept_hand && action(ui("callbreak.accept_hand"), 'ACCEPT_HAND')}{mine?.can_claim_redeal && action(ui("callbreak.request_redeal"), 'CLAIM_REDEAL')}</View>}
    <Text style={[styles.title, { fontSize: 22, marginVertical: 4 }]}>{mine ? ui("common.your_hand_count_cards", { "count": mine.hand.length }) : ui("rooms.spectator_view")}</Text>
    {mine && <PlayerHand onDragChange={setDraggingCard} compactControls turnKey={`${game.phase}:${game.turn.player_id}:${game.current_trick?.trick_number}`} view={handView} onViewChange={setHandView} dealKey={handDealKey} onRevealComplete={setRevealedDeal} hand={mine.hand} legalCards={mine.legal_cards}
      canPlay={!reveal && !busy && isTurn && game.phase === 'PLAYING'} onPlay={card => cards.act('PLAY_CARD', { card })} />}
    {!!error && <Text accessibilityRole="alert" style={styles.error}>{uiLabel(error, 'feedback')}</Text>}
    </View></MobileGameHand>}

    </View>
    </View>
    {!ended && snapshot.your_player_id && !handAvailable && <WaitingHandArea />}
    {socialOverlay}
  </View>;
}
const createStyles = (colors: ThemeColors) => StyleSheet.create({
  workspace: { flex: 1, minHeight: 0 },
  playColumn: { flex: 1, minHeight: 0, minWidth: 0, width: '100%', maxWidth: 1000, alignSelf: 'center' },
  lastTrick: { position: 'relative', zIndex: 20, flexShrink: 0, borderTopWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, paddingHorizontal: 20 },
  lastToggle: { minHeight: 36, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  lastCards: { position: 'absolute', bottom: '100%', left: 0, right: 0, flexDirection: 'row', gap: 6, padding: 14, backgroundColor: colors.surface, borderTopLeftRadius: 12, borderTopRightRadius: 12, borderWidth: 1, borderColor: colors.border },
  lastPlayer: { flex: 1, minWidth: 0, alignItems: 'center', gap: 5 },
  lastCard: { width: 48, height: 64, borderRadius: 7, borderWidth: 1, borderColor: colors.cardBorder, backgroundColor: colors.cardFace, alignItems: 'center', justifyContent: 'center' },
  lastWinner: { borderWidth: 3, borderColor: colors.cardSelectedBorder, backgroundColor: colors.cardSelected },
  lastFace: { fontFamily: fonts.display, fontSize: 24, color: colors.cardInk },
  guidance: { padding: 12, borderRadius: radii.medium, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface }, yourTurn: { borderColor: colors.accent, backgroundColor: colors.surface },
  pokeHint: { minHeight: 44, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderStyle: 'dashed', borderColor: colors.border, borderRadius: radii.medium, padding: 6, marginBottom: 10 },
  newGamePanel: { padding: 16, gap: 8, borderBottomWidth: 1, borderColor: colors.border },
  overlayHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingHorizontal: 16, borderBottomWidth: 1, borderColor: colors.border, minHeight: 60 },
  overlayTitle: { fontFamily: fonts.display, fontSize: 23, color: colors.text, flexShrink: 1 },
  body: { backgroundColor: colors.table, flex: 1, minHeight: 0 }, wideBody: { flexDirection: 'row', justifyContent: 'center' }, tableScroll: { flex: 1, minHeight: 0, minWidth: 0 },
  page: { flex: 1, backgroundColor: colors.background }, container: { flexGrow:1, alignItems: 'center' }, back: { minHeight: 44, justifyContent: 'center' }, link: { color: colors.accent, fontFamily: fonts.medium, fontSize: 12 },
  title: { fontFamily: fonts.display, fontSize: 28, color: colors.text, marginVertical: 12 }, meta: { fontFamily: fonts.body, color: colors.textMuted, fontSize: 11, lineHeight: 20 }, status: { fontFamily: fonts.medium, fontSize: 13, color: colors.accent, marginVertical: 12 }, error: { color: colors.danger, fontFamily: fonts.body, fontSize: 12 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10, paddingVertical: 10 }, button: { padding: 12, ...gameButtonStyle(colors, 'primary'), justifyContent: 'center', alignItems: 'center' }, buttonText: { color: colors.onPrimary, fontFamily: fonts.medium, fontSize: 12 },
  handDock: { paddingHorizontal: 20, paddingBottom: 8, borderTopWidth: 1, borderColor: colors.tableTrim, backgroundColor: colors.surface },

});
