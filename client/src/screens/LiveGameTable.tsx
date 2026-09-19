import { EndedTableNotice } from '../components/EndedTableNotice';
import { GameMenu, GameMenuMetadata } from '../components/GameMenu';
import { ActionCue } from '../components/ActionCue';
import type { RuleProposalView } from '../components/RuleProposal';
import { GameTableHeader } from '../components/GameTableHeader';
import { MobileGameHand } from '../components/MobileGameHand';
import { TableStartCue } from '../components/TableStartCue';
import { useMobileCards } from '../multiplayer/useMobileCards';
import { type ReactNode, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CardTable } from '../components/CardTable';
import { TurnPulse } from '../components/TurnPulse';
import { PlayerHand, type HandView } from '../components/PlayerHand';
import { LiveBidPrompt } from '../components/LiveBidPrompt';
import { GameDetails } from '../components/GameDetails';
import { RoundSummary } from '../components/RoundSummary';
import { roundGuidance } from '../multiplayer/roundFlow';
import { fonts, useTheme, useThemedStyles, type ThemeColors } from '../theme';
import type { ActionAck } from '../multiplayer/PendingGameAction';
import type { PlayerPhrase } from '../multiplayer/pokes';
import { PokeComposer } from '../components/PokeComposer';

export type PlayMode = 'manual';

type Trick = { trick_number: number; plays: { player_id: number; card: string }[]; complete: boolean; winner?: number };
export type RoomSnapshot = {
  rule_proposal?: RuleProposalView | null; chat_enabled?: boolean;
  room_id?: string; table_name?: string; path?: string;
  tables?: import('../multiplayer/tableNavigation').TableSummary[];
  can_create_new_game?: boolean;
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
  status: 'empty' | 'waiting' | 'playing' | 'finished' | 'ended'; match_id?: string; capacity?: number;
  players?: { player_id: number; user_id: string; display_name?: string; connected?: boolean }[]; your_player_id?: number | null; can_join?: boolean;
  play_mode?: PlayMode; remaining_ms?: number | null; error?: string | null;
  game?: { revision: number; phase: string; finished: boolean; winners: number[]; turn: { player_id: number | null };
    current_trick: Trick | null; scores_tenths: number[] };
  deal?: { attempt?: number; deal_number: number; dealer: number; tricks_completed: number; tricks_required: number; tricks: Trick[];
    players: { player_id: number; bid: number | null; tricks_won: number; cards_remaining: number }[] };
  private?: { hand: string[]; legal_cards: string[]; can_accept_hand: boolean; can_claim_redeal: boolean } | null;
  is_creator?: boolean; ready?: boolean;
  settings?: { weak_hand_enabled: boolean; no_spades_enabled: boolean; payments: number[] };
  deal_history?: { deal_number: number; complete: boolean; players: { player_id: number; bid: number | null; tricks_won: number; score_tenths: number | null }[] }[];
  scoreboard?: { player_id: number; deal_scores_tenths: (number | null)[]; total_score_tenths: number }[];
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
  const { colors } = useTheme();
  const ended = snapshot.status === 'ended';
  const endedNotice = <EndedTableNotice onBack={onBack} onNewGame={onNewGame} />;
  const styles = useThemedStyles(createStyles);
  const insets = useSafeAreaInsets();
  const screenWidth = useWindowDimensions().width;
  const wide = screenWidth >= 1000;
  const mobile = screenWidth < 900;
  const [tableWidth, setTableWidth] = useState(280);
  const width = Math.max(180, Math.min(tableWidth - 24, 800));
  const [revealedDeal, setRevealedDeal] = useState<string | null>(null);
  const handDealKey = `${snapshot.match_id}:${snapshot.deal?.deal_number}:${snapshot.deal?.attempt}`;
  const [expandedLastTrick, setExpandedLastTrick] = useState<string | null>(null);
  const [handView, setHandView] = useState<HandView>('fan');
  const [pokeTarget, setPokeTarget] = useState<number | null | undefined>(undefined);
  const [pokeNotice, setPokeNotice] = useState<{ text: string; at: number } | null>(null);
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
  const guidance = roundGuidance(snapshot);
  const playerName = (id: number) => snapshot.players?.find(p => p.player_id === id)?.display_name || `Player ${id}`;
  const game = snapshot.game, deal = snapshot.deal, mine = snapshot.private;
  const isTurn = !ended && !!snapshot.your_player_id && game?.turn.player_id === snapshot.your_player_id;
  const handAvailable = !ended && !!mine && mine.hand.length > 0 && !game?.finished && !snapshot.round_review;
  const promptKey = handAvailable && (isTurn || mine?.can_accept_hand)
    ? `${handDealKey}:${game?.phase}:${isTurn}:${game?.current_trick?.trick_number || deal?.tricks_completed || 0}` : null;
  const cards = useMobileCards({ mobile, busy, error, promptKey, onAction });
  const header = <GameTableHeader compact game="callbreak" title="Call Break" path={snapshot.path} roomId={snapshot.room_id} matchId={snapshot.match_id} onBack={onBack}
    drawerMetadata={<GameMenuMetadata snapshot={snapshot} />}>
    {close => <GameMenu snapshot={snapshot} close={close} back={onBack} tableControl={tableControl} leaveControl={lobbyControl} endControl={endControl}
      poke={() => setPokeTarget(null)} pokePlayer={setPokeTarget} canPoke={social.connected}
      gameContent={<GameDetails snapshot={snapshot} busy={busy} onSave={onSave} />} />}
  </GameTableHeader>;
  const socialOverlay = !ended && pokeTarget !== undefined && <PokeComposer recipient={pokeTarget} recipientName={snapshot.players?.find(p => p.player_id === pokeTarget)?.display_name} phrases={social.phrases} connected={social.connected}
    onClose={() => setPokeTarget(undefined)} onSave={social.save} onSend={async text => {
      await social.send(pokeTarget, text);
      setPokeNotice({ text: pokeTarget === null ? 'Sent to the table ✦' : `Poke sent to ${playerName(pokeTarget)} ✦`, at: Date.now() });
    }} />;
  const startCue = ended ? endedNotice : <TableStartCue snapshot={snapshot} busy={busy} onStart={onStart} onTableAction={onTableAction} onNewGame={onNewGame} />;
  if (ended && (!game || !deal)) return <View style={styles.page}>{header}<View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>{endedNotice}</View></View>;
  if (!game || !deal) return <View style={styles.page}>
    {header}
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 20 }}>
      <Text style={styles.title}>{snapshot.players?.length}/{snapshot.capacity} players seated</Text>
      <Text style={styles.meta}>{snapshot.ready ? 'Everyone is here. The first dealer will be chosen at random.' : 'Waiting for everyone to take a seat.'}</Text>
      <Text style={styles.meta}>Each player confirms their bid and taps a card to play. No turn time limit.</Text>
      <View style={{ width: '100%', maxWidth: 680, borderRadius: 24, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface }}>
        {startCue}{!snapshot.is_creator && <Text style={styles.status}>Waiting for the creator to start.</Text>}
      </View>
      {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
    </View>{socialOverlay}
  </View>;
  if (!ended && (snapshot.round_review || game.finished) && !reveal) return <View style={styles.page}>{header}<RoundSummary
    snapshot={snapshot} busy={busy} error={error || snapshot.error || ''} onContinue={onNextDeal} onBack={onBack} onNewGame={onNewGame}
    hideNavigation controls={game.finished ? startCue : snapshot.round_review?.can_continue ? <View testID="callbreak-center-next-deal" style={{ minHeight: 160, alignItems: 'center', justifyContent: 'center' }}>
      <Pressable accessibilityRole="button" accessibilityLabel="Start next deal" disabled={busy} onPress={onNextDeal} style={styles.button}><ActionCue active={!busy} style={styles.buttonText}>Start next deal</ActionCue></Pressable>
    </View> : <Text style={styles.meta}>Waiting for the creator to start the next deal.</Text>} />{socialOverlay}</View>;
  const showTurn = !ended && game.phase === 'PLAYING' && !game.finished && !reveal && !!game.turn.player_id;
  const players = deal.players.map(player => ({ id: String(player.player_id), name: playerName(player.player_id),
    connected: snapshot.players?.find(p => p.player_id === player.player_id)?.connected,
    bid: player.bid ?? 0, tricks: Math.max(0, player.tricks_won - (reveal && completedTrick?.winner === player.player_id ? 1 : 0)), cardsRemaining: player.cards_remaining }));
  const last = [...deal.tricks].reverse().find(trick => trick.complete);
  const trick = reveal ? completedTrick : game.current_trick;
  function action(label: string, command: string, payload = {}) {
    return <Pressable accessibilityRole="button" disabled={busy} accessibilityState={{ disabled: busy }} onPress={() => cards.act(command, payload)} style={styles.button}><ActionCue active={!busy} style={styles.buttonText}>{label}</ActionCue></Pressable>;
  }
  const preparation = isTurn && ['AWAITING_SHUFFLE', 'AWAITING_CUT', 'AWAITING_DISTRIBUTION'].includes(game.phase) ? <View testID="callbreak-center-preparation" style={{ gap: 8, alignItems: 'center' }}>
      {game.phase === 'AWAITING_SHUFFLE' && action('Shuffle deck', 'SHUFFLE_DECK')}
      {game.phase === 'AWAITING_CUT' && <>{action('Cut in half', 'CUT_DECK', { position: 26 })}{action('Skip cut', 'SKIP_CUT')}</>}
      {game.phase === 'AWAITING_DISTRIBUTION' && action('Deal cards', 'START_DISTRIBUTION')}
    </View> : null;
  return <View style={styles.page}>
    {header}

    <View style={[styles.workspace, wide && styles.wideBody]}>
    <View style={styles.playColumn}>
    <View style={styles.body}>
    <ScrollView style={styles.tableScroll} onLayout={event => setTableWidth(event.nativeEvent.layout.width)} contentContainerStyle={[styles.container, {
      paddingTop: 12, paddingBottom: mobile && handAvailable ? 110 : Math.max(insets.bottom, 16),
    }]}><View style={{ width }}>
    <Text style={styles.meta}>Deal {deal.deal_number} of 5 · {deal.tricks_completed}/{deal.tricks_required} tricks completed · Spades trump</Text>
    {!ended && game.phase !== 'PLAYING' && game.phase !== 'BIDDING' && !reveal && <Text style={styles.meta}>{guidance.title}</Text>}
    {!!(error || snapshot.error) && <Text accessibilityRole="alert" style={styles.error}>{error || snapshot.error}</Text>}
    <CardTable centerControl={ended ? endedNotice : preparation} width={width} players={players} dealerId={String(deal.dealer)} viewerId={snapshot.your_player_id ? String(snapshot.your_player_id) : ''}
      collectionKey={reveal ? trickKey : undefined} collecting={reveal && collectingTrick === trickKey}
      winnerPlayerId={reveal ? String(completedTrick?.winner) : undefined} activePlayerId={!ended && !reveal && game.turn.player_id ? String(game.turn.player_id) : ''} plays={(trick?.plays || []).map(play => ({ playerId: String(play.player_id), card: face(play.card) }))} />
    <View testID="central-turn-notice">
      {!ended && reveal && <Text accessibilityLiveRegion="polite" style={styles.status}>{playerName(completedTrick!.winner!)} wins trick {completedTrick!.trick_number}</Text>}
      {showTurn && (!mobile || !handAvailable) && <TurnPulse personal={isTurn} text={isTurn ? 'Your turn' : `${playerName(game.turn.player_id!)}'s turn`} />}
    </View>
    {!!pokeNotice && <Text accessibilityLiveRegion="polite" style={styles.meta}>{pokeNotice.text}</Text>}

  </View></ScrollView>

    </View>
    {last && (!mobile || !cards.open) && <View style={[styles.lastTrick, mobile && handAvailable && { position: 'absolute', bottom: 52, left: 0, right: 0 }]}>
      <Pressable accessibilityRole="button" accessibilityLabel="Last trick" aria-expanded={expandedLastTrick === trickKey} accessibilityState={{ expanded: expandedLastTrick === trickKey }}
        onPress={() => setExpandedLastTrick(value => value === trickKey ? null : trickKey)} style={styles.lastToggle}>
        <Text style={styles.meta}>Last trick - {playerName(last.winner!)} won</Text><Text style={styles.link}>{expandedLastTrick === trickKey ? '-' : '+'}</Text>
      </Pressable>
      {expandedLastTrick === trickKey && <View testID="last-trick-cards" style={styles.lastCards}>
        {last.plays.map((play, index) => <View key={play.player_id} style={styles.lastPlayer}>
          <Text numberOfLines={1} style={styles.meta}>{playerName(play.player_id)}</Text>
          <View testID={play.player_id === last.winner ? 'last-trick-winner' : undefined} accessibilityLabel={`${playerName(play.player_id)} played ${face(play.card)}${play.player_id === last.winner ? ', winner' : ''}`}
            style={[styles.lastCard, play.player_id === last.winner && styles.lastWinner]}>
            <Text style={[styles.lastFace, /[HD]$/.test(play.card) && { color: colors.cardRed }, play.card.endsWith('C') && { color: colors.cardClub }]}>{face(play.card)}</Text>
          </View>
          <Text style={styles.meta}>{play.player_id === last.winner ? 'Winner' : index === 0 ? 'Led' : `Play ${index + 1}`}</Text>
        </View>)}
      </View>}
    </View>}
    {handAvailable && <MobileGameHand mobile={mobile} game="callbreak" keepMounted
      header={showTurn ? <TurnPulse personal={isTurn} text={isTurn ? 'Your turn' : `${playerName(game.turn.player_id!)}'s turn`} /> : undefined}
      open={cards.open} onToggle={cards.toggle} myTurn={isTurn}
      attention={isTurn || !!mine?.can_accept_hand || !!mine?.can_claim_redeal}
      attentionText={mine?.can_accept_hand || mine?.can_claim_redeal ? 'Review your cards · Accept or request redeal' : undefined}>
    <View testID="callbreak-hand-dock" style={[styles.handDock, mobile && { backgroundColor: 'transparent', borderTopWidth: 0, paddingHorizontal: 4 }]}>
    {game.phase === 'PLAYING' && !deal.tricks.some(trick => trick.complete || trick.plays.length) && !game.current_trick?.plays.length && <Text accessibilityLiveRegion="polite" style={styles.status}>Bidding complete. {isTurn ? 'You lead first.' : `${playerName(game.turn.player_id!)} leads first.`}</Text>}
    {game.phase === 'BIDDING' && <LiveBidPrompt key={`${snapshot.match_id}-${deal.deal_number}-${deal.attempt}`} snapshot={snapshot} revealed={revealedDeal === handDealKey} busy={busy} onAction={cards.act} />}

    {(mine?.can_accept_hand || mine?.can_claim_redeal) && <View style={styles.actions}>{mine?.can_accept_hand && revealedDeal === handDealKey && action('Accept hand', 'ACCEPT_HAND')}{mine?.can_claim_redeal && action('Request redeal', 'CLAIM_REDEAL')}</View>}
    <Text style={[styles.title, { fontSize: 22, marginVertical: 4 }]}>{mine ? `Your hand · ${mine.hand.length} cards` : 'Spectator view'}</Text>
    {mine && <PlayerHand turnKey={`${game.phase}:${game.turn.player_id}:${game.current_trick?.trick_number}`} view={handView} onViewChange={setHandView} dealKey={handDealKey} onRevealComplete={setRevealedDeal} hand={mine.hand} legalCards={mine.legal_cards}
      canPlay={!reveal && !busy && isTurn && game.phase === 'PLAYING'} onPlay={card => cards.act('PLAY_CARD', { card })} />}
    {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
    </View></MobileGameHand>}

    </View>
    </View>
    {socialOverlay}
  </View>;
}
const createStyles = (colors: ThemeColors) => StyleSheet.create({
  workspace: { flex: 1, minHeight: 0 },
  playColumn: { flex: 1, minHeight: 0, minWidth: 0 },
  lastTrick: { position: 'relative', zIndex: 20, flexShrink: 0, borderTopWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, paddingHorizontal: 20 },
  lastToggle: { minHeight: 36, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  lastCards: { position: 'absolute', bottom: '100%', left: 0, right: 0, flexDirection: 'row', gap: 6, padding: 14, backgroundColor: colors.surface, borderTopLeftRadius: 12, borderTopRightRadius: 12, borderWidth: 1, borderColor: colors.border },
  lastPlayer: { flex: 1, minWidth: 0, alignItems: 'center', gap: 5 },
  lastCard: { width: 48, height: 64, borderRadius: 7, borderWidth: 1, borderColor: colors.cardBorder, backgroundColor: colors.cardFace, alignItems: 'center', justifyContent: 'center' },
  lastWinner: { borderWidth: 3, borderColor: colors.cardSelectedBorder, backgroundColor: colors.cardSelected },
  lastFace: { fontFamily: fonts.display, fontSize: 24, color: colors.cardInk },
  guidance: { padding: 12, borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface }, yourTurn: { borderColor: colors.accent, backgroundColor: colors.surface },
  pokeHint: { minHeight: 44, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderStyle: 'dashed', borderColor: colors.border, borderRadius: 10, padding: 6, marginBottom: 10 },
  newGamePanel: { padding: 16, gap: 8, borderBottomWidth: 1, borderColor: colors.border },
  overlayHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingHorizontal: 16, borderBottomWidth: 1, borderColor: colors.border, minHeight: 60 },
  overlayTitle: { fontFamily: fonts.display, fontSize: 23, color: colors.text, flexShrink: 1 },
  body: { flex: 1, minHeight: 0 }, wideBody: { flexDirection: 'row' }, tableScroll: { flex: 1, minHeight: 0, minWidth: 0 },
  page: { flex: 1, backgroundColor: colors.background }, container: { alignItems: 'center' }, back: { minHeight: 44, justifyContent: 'center' }, link: { color: colors.accent, fontFamily: fonts.medium, fontSize: 12 },
  title: { fontFamily: fonts.display, fontSize: 28, color: colors.text, marginVertical: 12 }, meta: { fontFamily: fonts.body, color: colors.textMuted, fontSize: 11, lineHeight: 20 }, status: { fontFamily: fonts.medium, fontSize: 13, color: colors.accent, marginVertical: 12 }, error: { color: colors.danger, fontFamily: fonts.body, fontSize: 12 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10, paddingVertical: 10 }, button: { minHeight: 44, minWidth: 44, padding: 12, borderRadius: 8, backgroundColor: colors.surfaceSelected, justifyContent: 'center', alignItems: 'center' }, buttonText: { color: colors.text, fontFamily: fonts.medium, fontSize: 12 },
  handDock: { paddingHorizontal: 20, paddingBottom: 8, borderTopWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },

});
