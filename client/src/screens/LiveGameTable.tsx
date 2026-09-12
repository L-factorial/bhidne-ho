import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CardTable } from '../components/CardTable';
import { TurnPulse } from '../components/TurnPulse';
import { PlayerHand, type HandView } from '../components/PlayerHand';
import { LiveBidPrompt } from '../components/LiveBidPrompt';
import { GameDetails } from '../components/GameDetails';
import { RoundSummary } from '../components/RoundSummary';
import { ROUND_STEPS, roundGuidance } from '../multiplayer/roundFlow';
import { GameHistory } from '../components/GameHistory';
import { colors, fonts } from '../theme';
import type { ActionAck } from '../multiplayer/PendingGameAction';
import type { PlayerPhrase } from '../multiplayer/pokes';
import { PokeComposer } from '../components/PokeComposer';

export type PlayMode = 'manual' | 'auto';

type Trick = { trick_number: number; plays: { player_id: number; card: string }[]; complete: boolean; winner?: number };
export type RoomSnapshot = {
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

export function LiveGameTable({ snapshot, busy, error, onAction, onBack, onStart, onSave, onNewGame, onNextDeal, social }: {
  social: { connected: boolean; phrases: PlayerPhrase[]; save: (text: string) => Promise<void>; send: (recipient: number | null, text: string) => Promise<void> };
  onNextDeal: () => void; onNewGame: () => void; onStart: (playMode: PlayMode) => void; onSave: (settings: NonNullable<RoomSnapshot['settings']>) => void;
  snapshot: RoomSnapshot; busy: boolean; error: string; onAction: (command: string, payload?: object) => void; onBack: () => void;
}) {
  const insets = useSafeAreaInsets();
  const wide = useWindowDimensions().width >= 1000;
  const [tableWidth, setTableWidth] = useState(280);
  const width = Math.max(180, Math.min(tableWidth - 24, 800));
  const [revealedDeal, setRevealedDeal] = useState<string | null>(null);
  const handDealKey = `${snapshot.match_id}:${snapshot.deal?.deal_number}:${snapshot.deal?.attempt}`;
  const [handView, setHandView] = useState<HandView>('fan');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [playMode, setPlayMode] = useState<PlayMode>('manual');
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
  if (!game || !deal) return <View style={styles.page}>
    <View style={styles.overlayHeader}><Text style={styles.overlayTitle}>Call Break · Ready to play</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Collapse game" onPress={onBack} style={styles.back}><Text style={styles.link}>Collapse ↘</Text></Pressable></View>
    <GameDetails snapshot={snapshot} busy={busy} onSave={onSave} />
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 20 }}>
      <Text style={styles.title}>{snapshot.players?.length}/{snapshot.capacity} players seated</Text>
      <Text style={styles.meta}>{snapshot.ready ? 'Everyone is here. The first dealer will be chosen at random.' : 'Waiting for everyone to take a seat.'}</Text>
      {snapshot.is_creator && <View style={{ gap: 8 }}>
        <Text style={styles.meta}>Play mode</Text>
        <View style={styles.actions}>{(['manual', 'auto'] as const).map(mode => <Pressable key={mode}
          accessibilityRole="radio" accessibilityState={{ checked: playMode === mode, disabled: busy }} disabled={busy}
          onPress={() => setPlayMode(mode)} style={[styles.button, { backgroundColor: playMode === mode ? colors.copper : '#263E54' }]}>
          <Text style={styles.buttonText}>{mode === 'manual' ? 'Player play' : 'Autoplay'}</Text>
        </Pressable>)}</View>
        <Text style={styles.meta}>{playMode === 'manual'
          ? 'Each player confirms their bid and taps a card to play. No turn time limit.'
          : 'Inactive turns advance automatically after three seconds.'}</Text>
      </View>}
      {snapshot.is_creator ? <Pressable accessibilityRole="button" disabled={busy || !snapshot.ready} accessibilityState={{ disabled: busy || !snapshot.ready }} onPress={() => onStart(playMode)} style={[styles.button, { opacity: snapshot.ready && !busy ? 1 : 0.5 }]}><Text style={styles.buttonText}>{busy ? 'Starting…' : 'Start game'}</Text></Pressable>
        : <Text style={styles.status}>Waiting for the creator to start the game.</Text>}
      {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
    </View>
  </View>;
  if ((snapshot.round_review || game.finished) && !reveal) return <RoundSummary
    snapshot={snapshot} busy={busy} error={error || snapshot.error || ''} onContinue={onNextDeal} onBack={onBack} onNewGame={onNewGame} />;
  const isTurn = !!snapshot.your_player_id && game.turn.player_id === snapshot.your_player_id;
  const showTurn = game.phase === 'PLAYING' && !game.finished && !reveal && !!game.turn.player_id;
  const players = deal.players.map(player => ({ id: String(player.player_id), name: playerName(player.player_id),
    connected: snapshot.players?.find(p => p.player_id === player.player_id)?.connected,
    bid: player.bid ?? 0, tricks: Math.max(0, player.tricks_won - (reveal && completedTrick?.winner === player.player_id ? 1 : 0)), cardsRemaining: player.cards_remaining }));
  const last = [...deal.tricks].reverse().find(trick => trick.complete);
  const trick = reveal ? completedTrick : game.current_trick;
  const leadsNext = !reveal && completedTrick && game.phase === 'PLAYING' && !game.current_trick?.plays.length;
  function action(label: string, command: string, payload = {}) {
    return <Pressable accessibilityRole="button" disabled={busy} accessibilityState={{ disabled: busy }} onPress={() => onAction(command, payload)} style={styles.button}><Text style={styles.buttonText}>{label}</Text></Pressable>;
  }
  return <View style={styles.page}>
    {showTurn && isTurn && <TurnPulse personal text="Your turn" />}
    <View style={styles.overlayHeader}>
      <Text accessibilityRole="header" style={styles.overlayTitle}>भिड्ने हो? · Call Break · Live game</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Collapse game" onPress={onBack} style={styles.back}><Text style={styles.link}>Collapse ↘</Text></Pressable>
    </View>
    <GameDetails snapshot={snapshot} busy={busy} onSave={onSave} />
    {game.finished && <View style={styles.newGamePanel}>
      <Text style={styles.status}>Game complete · ready for another round?</Text>
      <Pressable accessibilityRole="button" disabled={busy} accessibilityState={{ disabled: busy }} onPress={onNewGame} style={styles.button}>
        <Text style={styles.buttonText}>Start a new game</Text>
      </Pressable>
    </View>}
    <View style={[styles.body, wide && styles.wideBody]}>
    <ScrollView style={styles.tableScroll} onLayout={event => setTableWidth(event.nativeEvent.layout.width)} contentContainerStyle={[styles.container, {
      paddingTop: 12, paddingBottom: Math.max(insets.bottom, 16),
    }]}><View style={{ width }}>
    <Text style={styles.meta}>Deal {deal.deal_number} of 5 · {deal.tricks_completed}/{deal.tricks_required} tricks completed · Spades trump</Text>
    <View style={[styles.guidance, guidance.mine && styles.yourTurn]}>
      <Text style={styles.meta}>{ROUND_STEPS.map((step, i) => i === guidance.step ? `[${step}]` : step).join(' > ')}</Text>
      <Text accessibilityLiveRegion="polite" style={styles.status}>{reveal ? `${playerName(completedTrick!.winner!)} wins trick ${completedTrick!.trick_number}` : leadsNext ? `${playerName(game.turn.player_id!)} leads next` : guidance.title}</Text>
      <Text style={styles.meta}>{reveal ? (game.finished || snapshot.round_review ? 'Collecting the final trick before scores.' : collectingTrick === trickKey ? 'Collecting the cards.' : 'Winning card highlighted.') : guidance.instruction}</Text>
    </View>
    {!game.finished && snapshot.play_mode === 'auto' && snapshot.remaining_ms != null && <Text style={styles.meta}>Automatic move in {Math.ceil(snapshot.remaining_ms / 1000)}s</Text>}
    {!!(error || snapshot.error) && <Text accessibilityRole="alert" style={styles.error}>{error || snapshot.error}</Text>}
    <View style={styles.actions}>
      {isTurn && game.phase === 'AWAITING_SHUFFLE' && action('Shuffle deck', 'SHUFFLE_DECK')}
      {isTurn && game.phase === 'AWAITING_CUT' && <>{action('Cut in half', 'CUT_DECK', { position: 26 })}{action('Skip cut', 'SKIP_CUT')}</>}
      {isTurn && game.phase === 'AWAITING_DISTRIBUTION' && action('Deal cards', 'START_DISTRIBUTION')}
      {mine?.can_accept_hand && revealedDeal === handDealKey && action('Accept hand', 'ACCEPT_HAND')}
      {mine?.can_claim_redeal && action('Request redeal', 'CLAIM_REDEAL')}
    </View>
    {showTurn && <TurnPulse text={`Player ${game.turn.player_id}'s turn`} />}
    <CardTable width={width} players={players} dealerId={String(deal.dealer)} viewerId={snapshot.your_player_id ? String(snapshot.your_player_id) : ''}
      tricksRemaining={Math.max(0, deal.tricks_required - deal.tricks_completed + (reveal ? 1 : 0))}
      onPokePlayer={snapshot.your_player_id && social.connected ? id => setPokeTarget(Number(id)) : undefined}
      onPokeTable={snapshot.your_player_id && social.connected ? () => setPokeTarget(null) : undefined}
      collectionKey={reveal ? trickKey : undefined} collecting={reveal && collectingTrick === trickKey}
      winnerPlayerId={reveal ? String(completedTrick?.winner) : undefined} activePlayerId={!reveal && game.turn.player_id ? String(game.turn.player_id) : ''} plays={(trick?.plays || []).map(play => ({ playerId: String(play.player_id), card: face(play.card) }))} />
    {!!snapshot.your_player_id && <Pressable accessibilityRole="button" accessibilityLabel="Poke the whole table"
      disabled={!social.connected} onPress={() => setPokeTarget(null)} style={styles.pokeHint}>
      <Text style={styles.link}>✦ Tap a player to poke · Tap cards for table talk</Text>
    </Pressable>}
    {!!pokeNotice && <Text accessibilityLiveRegion="polite" style={styles.meta}>{pokeNotice.text}</Text>}
    {last && <View><Text style={styles.meta}>Last trick · won by {playerName(last.winner!)}</Text><View style={styles.actions}>{last.plays.map(play => <Text key={play.player_id} style={styles.meta}>P{play.player_id}: {face(play.card)}</Text>)}</View></View>}
  </View></ScrollView>
    {historyOpen && <View style={wide ? styles.historySide : styles.historyBottom}>
      <GameHistory snapshot={snapshot} />
    </View>}
    </View>
    <View style={styles.handDock}>
    {game.phase === 'PLAYING' && !deal.tricks.some(trick => trick.complete || trick.plays.length) && !game.current_trick?.plays.length && <Text accessibilityLiveRegion="polite" style={styles.status}>Bidding complete. {isTurn ? 'You lead first.' : `${playerName(game.turn.player_id!)} leads first.`}</Text>}
    {game.phase === 'BIDDING' && <LiveBidPrompt key={`${snapshot.match_id}-${deal.deal_number}-${deal.attempt}`} snapshot={snapshot} revealed={revealedDeal === handDealKey} busy={busy} onAction={onAction} />}

    <Text style={[styles.title, { fontSize: 22, marginVertical: 4 }]}>{mine ? `Your hand · ${mine.hand.length} cards` : 'Spectator view'}</Text>
    {mine && <PlayerHand turnKey={`${game.phase}:${game.turn.player_id}:${game.current_trick?.trick_number}`} view={handView} onViewChange={setHandView} dealKey={handDealKey} onRevealComplete={setRevealedDeal} hand={mine.hand} legalCards={mine.legal_cards}
      canPlay={!reveal && !busy && isTurn && game.phase === 'PLAYING'} onPlay={card => onAction('PLAY_CARD', { card })} />}
    {!mine && <Text style={styles.meta}>Only seated players can see their own hand.</Text>}
    <Text style={styles.meta}>♠ Spades · <Text style={{ color: '#78D5A8' }}>♣ Clubs</Text> · ♥ Hearts · ♦ Diamonds</Text>
    </View>
    {<Pressable accessibilityRole="button" accessibilityState={{ expanded: historyOpen }} onPress={() => setHistoryOpen(value => !value)} style={styles.historyToggle}>
      <Text style={styles.link}>{historyOpen ? 'Hide history' : 'Show game history'}</Text>
    </Pressable>}
    {pokeTarget !== undefined && <PokeComposer recipient={pokeTarget} phrases={social.phrases} connected={social.connected}
      onClose={() => setPokeTarget(undefined)} onSave={social.save} onSend={async text => {
        await social.send(pokeTarget, text);
        setPokeNotice({ text: pokeTarget === null ? 'Sent to the table ✦' : `Poke sent to ${playerName(pokeTarget)} ✦`, at: Date.now() });
      }} />}
  </View>;
}
const styles = StyleSheet.create({
  guidance: { padding: 12, borderRadius: 10, borderWidth: 1, borderColor: '#365267', backgroundColor: '#183750' }, yourTurn: { borderColor: '#8EDBFF', backgroundColor: '#173E58' },
  pokeHint: { minHeight: 44, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderStyle: 'dashed', borderColor: '#D2AF794D', borderRadius: 10, padding: 6, marginBottom: 10 },
  newGamePanel: { padding: 16, gap: 8, borderBottomWidth: 1, borderColor: '#FFFFFF19' },
  overlayHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingHorizontal: 16, borderBottomWidth: 1, borderColor: '#FFFFFF19', minHeight: 60 },
  overlayTitle: { fontFamily: fonts.display, fontSize: 23, color: colors.ivory, flexShrink: 1 },
  body: { flex: 1, minHeight: 0 }, wideBody: { flexDirection: 'row' }, tableScroll: { flex: 1, minHeight: 0, minWidth: 0 },
  historySide: { width: 280, borderLeftWidth: 1, borderColor: '#FFFFFF19' }, historyBottom: { height: 250, maxHeight: '48%', borderTopWidth: 1, borderColor: '#FFFFFF19' },
  historyToggle: { minHeight: 48, alignItems: 'center', justifyContent: 'center', borderTopWidth: 1, borderColor: '#FFFFFF19' },
  page: { flex: 1, backgroundColor: colors.navy }, container: { alignItems: 'center' }, back: { minHeight: 44, justifyContent: 'center' }, link: { color: colors.champagne, fontFamily: fonts.medium, fontSize: 12 },
  title: { fontFamily: fonts.display, fontSize: 28, color: colors.ivory, marginVertical: 12 }, meta: { fontFamily: fonts.body, color: '#C1CBD5', fontSize: 11, lineHeight: 20 }, status: { fontFamily: fonts.medium, fontSize: 13, color: colors.champagne, marginVertical: 12 }, error: { color: '#FFD1C5', fontFamily: fonts.body, fontSize: 12 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10, paddingVertical: 10 }, button: { minHeight: 44, minWidth: 44, padding: 12, borderRadius: 8, backgroundColor: colors.copper, justifyContent: 'center', alignItems: 'center' }, buttonText: { color: colors.ivory, fontFamily: fonts.medium, fontSize: 12 },
  handDock: { paddingHorizontal: 20, paddingBottom: 8, borderTopWidth: 1, borderColor: '#FFFFFF19', backgroundColor: '#11273C' },

});
