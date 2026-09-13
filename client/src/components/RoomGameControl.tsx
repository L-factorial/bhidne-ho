import { AppHeader } from './AppHeader';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useGameNotification } from '../notifications/useGameNotification';
import { fonts, useTheme, useThemedStyles, type ThemeColors } from '../theme';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LiveGameTable, RoomSnapshot as Snapshot } from '../screens/LiveGameTable';
import { GameCommandClient, createHttpGameTransport } from '../multiplayer/GameCommandClient';
import type { RoomPoke } from '../multiplayer/pokes';
import { useRoomPokes } from '../multiplayer/useRoomPokes';
import type { usePlayerPhrases } from '../multiplayer/usePlayerPhrases';
import { EndGameControl } from './EndGameControl';
import { PokeOverlay } from './PokeOverlay';
import { FlushTable } from '../screens/FlushTable';
import { MarriageTable } from '../screens/MarriageTable';


export function RoomGameControl({ roomId, apiUrl, token, connected, members, connectionMessage, userId, pokes, personal, createContent, creationEnabled = true, gameType = 'callbreak' }: {
  gameType?: 'callbreak' | 'marriage' | 'flush';
  createContent?: ReactNode; creationEnabled?: boolean;
  userId: string; pokes: RoomPoke[]; personal: ReturnType<typeof usePlayerPhrases>;
  roomId: string; apiUrl: string; token: string; connected: boolean; members: string[]; connectionMessage?: string;
}) {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const insets = useSafeAreaInsets();
  const social = useRoomPokes(roomId, userId, token, connected);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [joinOpen, setJoinOpen] = useState(false);
  const [dismissedInvitation, setDismissedInvitation] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [live, setLive] = useState(false);
  const collapsed = !open && live && !!snapshot && snapshot.status !== 'empty';
  const notification = useGameNotification(snapshot, collapsed);
  function collapseGame() { notification.prepare(); setOpen(false); }
  const enteredMatch = useRef<string | null>(null);
  const [capacity, setCapacity] = useState(4);
  useEffect(() => { if (gameType === 'callbreak') setCapacity(value => Math.max(4, value)); }, [gameType]);
  const [pendingAction, setBusy] = useState(false);
  const base = `${apiUrl}/test-games/${encodeURIComponent(roomId)}`;
  const transport = useMemo(() => createHttpGameTransport<Snapshot>(base, token), [base, token]);
  const commandClient = useMemo(() => new GameCommandClient(transport), [transport]);
  const [actionTick, setActionTick] = useState(0);
  const [actionNotice, setActionNotice] = useState('');
  const [synced, setSynced] = useState(false);
  const busy = pendingAction || !connected || !synced;
  const [actionError, setError] = useState('');
  const [refreshError, setRefreshError] = useState('');
  const error = actionError || refreshError;
  const generation = useRef(0), pending = useRef(false);
  const alive = useRef(true);
  const requests = useRef(new Set<AbortController>());
  const canSend = useRef(false);
  canSend.current = connected && synced && !commandClient.pending;
  const visibleSnapshot = snapshot ? { ...snapshot, players: snapshot.players?.map(player => ({
    ...player, connected: members.includes(player.user_id) && (player.player_id !== snapshot.your_player_id || connected),
  })) } : null;
  useEffect(() => {
    if ((snapshot?.ready || snapshot?.game) && snapshot.your_player_id && snapshot.match_id !== enteredMatch.current) {
      enteredMatch.current = snapshot.match_id || null; setLive(true); setOpen(true);
    }
  }, [snapshot?.match_id, snapshot?.ready, snapshot?.game, snapshot?.your_player_id]);
  async function api(suffix = '', body?: object, signal?: AbortSignal): Promise<Snapshot> {
    const controller = new AbortController();
    requests.current.add(controller);
    const abort = () => controller.abort();
    if (signal?.aborted) abort();
    signal?.addEventListener('abort', abort, { once: true });
    try {
      return await transport.request(suffix, body, controller.signal);
    } finally {
      signal?.removeEventListener('abort', abort); requests.current.delete(controller);
    }
  }

  useEffect(() => {
    alive.current = true;
    setSynced(false);
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      const version = generation.current;
      try {
        if (!pending.current) {
          const hadPending = commandClient.pending;
          if (hadPending) setActionNotice('Confirming your action…');
          const result = await commandClient.refresh(controller.signal);
          if (controller.signal.aborted || generation.current !== version) return;
          const data = result.snapshot;
          if (hadPending) {
            setError(result.error); setBusy(false); setActionNotice('');
          }
          if (!controller.signal.aborted && generation.current === version) {
            setSnapshot(data); setRefreshError(''); setSynced(true);
          }
        }
      } catch (error) {
        if (!controller.signal.aborted && generation.current === version) {
          const message = error instanceof Error ? error.message : 'Cannot load game.';
          setSynced(false);
          if (commandClient.pending) setActionNotice('Connection interrupted. Your action will be checked automatically…');
          // Room connection feedback is already handled by the parent screen.
          setRefreshError(message === 'Connect to this room before using its test game.' ? '' : message);
        }
      }
      finally { if (!controller.signal.aborted) timer = setTimeout(refresh, 1000); }
    }
    if (connected) refresh();
    return () => {
      alive.current = false; generation.current++; controller.abort(); clearTimeout(timer);
      requests.current.forEach(request => request.abort());
    };
  }, [commandClient, connected, actionTick]);
  async function act(join: boolean) {
    if (!canSend.current || pending.current) return;
    pending.current = true; const version = ++generation.current; setBusy(true); setError('');
    try {
      const data = await api(join ? '/join' : '', join ? { match_id: snapshot?.match_id } : { player_count: gameType === 'flush' ? 10 : capacity, game_type: gameType });
      if (alive.current && generation.current === version) {
        enteredMatch.current = data.match_id || null;
        setSnapshot(data); setLive(true); setOpen(true);
      }
    } catch (error) { if (alive.current && generation.current === version) setError(error instanceof Error ? error.message : 'Cannot update game.'); }
    finally { pending.current = false; if (alive.current) setBusy(false); }
  }
  const canCreate = snapshot?.status === 'empty' || snapshot?.status === 'finished' || snapshot?.status === 'ended';
  const gameName = ({ marriage: 'Marriage', callbreak: 'Call Break', flush: 'Flush' })[(canCreate ? gameType : snapshot?.game_type) || 'callbreak'];
  const noun = (canCreate ? gameType : snapshot?.game_type) === 'flush' ? 'table' : 'game';
  const createNoun = gameType === 'flush' ? 'table' : 'game';
  async function gameAction(command: string, payload: object = {}) {
    if (!canSend.current || !snapshot?.game || !snapshot.match_id || pending.current) return;
    if (!commandClient.submit(snapshot, command, payload)) return;
    canSend.current = false; generation.current++;
    setBusy(true); setError(''); setActionNotice('Sending your action…');
    setActionTick(value => value + 1);
  }
  async function lobbyAction(suffix: string, payload: object = {}) {
    if (!canSend.current || !snapshot || pending.current) return;
    pending.current = true; const version = ++generation.current; setBusy(true); setError('');
    try {
      const data = await api(suffix, { match_id: snapshot.match_id, ...payload });
      if (alive.current && generation.current === version) {
        setSnapshot(data);
        if (suffix === '/leave') { setOpen(false); setLive(false); enteredMatch.current = null; }
      }
    } catch (error) { if (alive.current && generation.current === version) setError(error instanceof Error ? error.message : 'Could not update game.'); }
    finally { pending.current = false; if (alive.current) setBusy(false); }
  }
  const actionLabel = !snapshot ? `Loading ${noun}…` : (snapshot.status === 'finished' || snapshot.status === 'ended') ? (snapshot.game_type === 'flush' ? 'Start a new table' : 'Start a new game') : canCreate ? `Create ${createNoun}`
    : snapshot.can_join ? `Join ${noun}` : snapshot.your_player_id ? `Enter ${noun}` : `Watch ${noun}`;
  const summary = !snapshot ? `Loading room ${noun}…` : snapshot.status === 'empty' ? `No ${noun} yet. Create one for everyone in this room.`
    : snapshot.status === 'waiting' ? `${gameName} · ${snapshot.players?.length}/${snapshot.capacity} players ready`
    : snapshot.status === 'ended' ? `${gameName} - Ended by the creator` : snapshot.status === 'finished' ? `${gameName} - Game finished` : `${gameName} · ${snapshot.game?.phase.replaceAll('_', ' ').toLowerCase() || 'In progress'}`;
  const endControl = snapshot?.is_creator && !canCreate
    ? <EndGameControl table={snapshot.game_type === 'flush'} key={`end-${snapshot.match_id}`} busy={busy} onEnd={() => lobbyAction('/end')} /> : null;
  const leaveControl = (snapshot?.status === 'waiting' || snapshot?.roster_open) && snapshot.your_player_id
    ? <Pressable accessibilityRole="button" accessibilityLabel={`Leave ${noun}`} disabled={busy} accessibilityState={{ disabled: busy }} onPress={() => void lobbyAction('/leave')} style={styles.choice}><Text style={[styles.text, live && open && { color: colors.text }]}>{`Leave ${noun}`}</Text></Pressable> : null;
  return <>
    {!open && snapshot?.match_id && snapshot.can_join && !snapshot.your_player_id && !snapshot.is_creator && dismissedInvitation !== snapshot.match_id && <View testID="game-created-notice" style={styles.invitation}>
      <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.summary}>A new {gameName} {noun} is ready!</Text>
      <Text style={styles.text}>Someone in your room created a {noun}. Take a seat to play.</Text>
      <View style={styles.choices}>
        <Pressable accessibilityRole="button" onPress={() => { setJoinOpen(true); setDismissedInvitation(snapshot.match_id!); }} style={styles.button}><Text style={styles.buttonText}>{`View ${noun}`}</Text></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={`Dismiss ${noun} notification`} onPress={() => setDismissedInvitation(snapshot.match_id!)} style={styles.choice}><Text style={styles.text}>Dismiss</Text></Pressable>
      </View>
    </View>}
    {collapsed && <View style={styles.returnPanel}>
      <Animated.View style={{ opacity: notification.opacity }}>
        <Pressable accessibilityRole="button" accessibilityLabel={`Go back to ${noun}`} onPress={() => setOpen(true)} style={[styles.button, !!notification.notice && styles.notified]}>
          <Text style={styles.buttonText}>{notification.notice ? '✦ ' : ''}Go back to {noun}</Text>
        </Pressable>
      </Animated.View>
      {!!notification.notice && <Text accessibilityLiveRegion="polite" style={styles.text}>{notification.notice}</Text>}
      <Pressable accessibilityRole="button" accessibilityLabel={notification.muted ? 'Unmute game notifications' : 'Mute game notifications'} onPress={notification.toggleSound} style={styles.choice}><Text style={styles.note}>{notification.muted ? 'Sound off' : 'Sound on · pong'}</Text></Pressable>
    </View>}
    <View style={styles.roomCard}>
      <Pressable accessibilityRole="button" accessibilityLabel={`Create a ${createNoun}`} aria-expanded={createOpen} accessibilityState={{ expanded: createOpen }} onPress={() => setCreateOpen(value => !value)} style={styles.sectionToggle}>
        <Text style={styles.summary}>{`Create a ${createNoun}`}</Text><Text style={styles.summary}>{createOpen ? '-' : '+'}</Text>
      </Pressable>
      {createOpen && <View style={{ gap: 12 }}>
        {createContent}
        {canCreate ? <Pressable accessibilityRole="button" accessibilityLabel={`Create ${createNoun}`} disabled={busy || !creationEnabled} accessibilityState={{ disabled: busy || !creationEnabled }} onPress={() => { setLive(false); setOpen(true); }} style={[styles.button, (busy || !creationEnabled) && { opacity: 0.5 }]}>
          <Text style={styles.buttonText}>{`Create ${createNoun}`}</Text>
        </Pressable> : <Text style={styles.text}>{!snapshot ? `Loading ${noun}…` : `A ${noun} is already open. Expand Join a ${noun} to enter it.`}</Text>}
      </View>}
    </View>
    <View style={styles.roomCard}>
      <Pressable accessibilityRole="button" accessibilityLabel={`Join a ${noun}`} aria-expanded={joinOpen} accessibilityState={{ expanded: joinOpen }} onPress={() => setJoinOpen(value => !value)} style={styles.sectionToggle}>
        <Text style={styles.summary}>{`Join a ${noun}`}</Text><Text style={styles.summary}>{joinOpen ? '-' : '+'}</Text>
      </Pressable>
      {joinOpen && (canCreate ? <Text style={styles.text}>No active {noun} to join. Create a {noun} to get started.</Text> : <>
    <View style={styles.bar}>
      <View style={{ flex: 1, minWidth: 150 }}>
        <Text style={styles.summary}>{summary}</Text>
        {snapshot?.status === 'waiting' && <Text style={styles.joinHint}>{snapshot.your_player_id
          ? `Your seat: player ${snapshot.your_player_id}. Waiting for other players.`
          : `You are in the room. Join the ${noun} to take a seat.`}</Text>}
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel={actionLabel} disabled={!snapshot || busy}
        accessibilityState={{ disabled: !snapshot || busy }}
        onPress={() => { if (snapshot?.can_join) void act(true); else { setLive(!!snapshot && !canCreate); setOpen(true); } }}
        style={[styles.button, (!snapshot || busy) && { opacity: 0.5 }]}>
        <Text style={styles.buttonText}>{busy ? 'Joining…' : actionLabel}</Text>
      </Pressable>
    </View>
      </>)}
    </View>
    {!open && endControl}
    {!open && leaveControl}
    {!collapsed && !open && snapshot?.status !== 'ended' && snapshot?.game?.phase === 'BIDDING' && !!snapshot.your_player_id && <View style={styles.bidNotice}>
      <Text accessibilityRole="alert" accessibilityLiveRegion="assertive" style={styles.text}>Deal {snapshot.deal?.deal_number} · {snapshot.game.turn.player_id === snapshot.your_player_id ? 'Your turn to bid' : 'Bidding is open'}</Text>
      <Pressable accessibilityRole="button" onPress={() => { setLive(true); setOpen(true); }} style={styles.button}><Text style={styles.buttonText}>View cards & bidding</Text></Pressable>
    </View>}
    {snapshot?.status === 'finished' && <Pressable accessibilityRole="button" onPress={() => { setLive(true); setOpen(true); }} style={styles.choice}><Text style={styles.text}>{snapshot?.game_type === 'marriage' ? 'View game result' : 'View final scores'}</Text></Pressable>}
    {!!actionNotice && !open && <Text accessibilityLiveRegion="polite" style={styles.note}>{actionNotice}</Text>}
    {!!error && !open && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
    {!open && <PokeOverlay pokes={pokes} matchId={snapshot?.match_id} />}
    <Modal transparent visible={open} animationType="fade" onRequestClose={collapseGame}>
      {live && snapshot ? <View testID="live-game-backdrop" style={[styles.liveBackdrop, {
        paddingTop: insets.top, paddingBottom: insets.bottom,
        paddingLeft: insets.left, paddingRight: insets.right,
      }]}><View accessibilityViewIsModal testID="live-game-overlay" style={styles.liveOverlay}>
        {snapshot.can_join && !snapshot.your_player_id && <View testID="in-game-invitation" style={[styles.invitation, { padding: 14, margin: 12, marginBottom: 0 }]}>
          <Text accessibilityRole="alert" accessibilityLiveRegion="assertive" style={styles.summary}>A new {gameName} {noun} is ready!</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={`Join ${noun}`} disabled={busy} accessibilityState={{ disabled: busy }} onPress={() => void act(true)} style={styles.button}>
            <Text style={styles.buttonText}>{`Join ${noun}`}</Text>
          </Pressable>
        </View>}
        {(!connected || !synced) && <Text accessibilityRole="alert" style={styles.connectionNotice}>{connectionMessage || (!connected ? 'Reconnecting… Your seat is saved.' : 'Updating game…')}</Text>}
        {!!actionNotice && <Text accessibilityLiveRegion="polite" style={styles.connectionNotice}>{actionNotice}</Text>}
        {snapshot.game_type === 'callbreak' && leaveControl}
        {snapshot.status === 'ended' ? <View style={styles.body}><AppHeader title={gameName} />
          <Text style={[styles.title, { color: colors.text }]}>{snapshot.game_type === 'flush' ? 'Table ended' : 'Game ended'}</Text>
          <Text style={[styles.text, { color: colors.text }]}>{snapshot.game_type === 'flush' ? 'The creator ended this table. The room is still open for a new table.' : 'The creator ended this game. The room is still open for another round.'}</Text>
          <Pressable accessibilityRole="button" onPress={() => { setLive(false); setOpen(true); }} style={styles.button}><Text style={styles.buttonText}>{snapshot.game_type === 'flush' ? 'Start a new table' : 'Start a new game'}</Text></Pressable>
          <Pressable accessibilityRole="button" onPress={collapseGame} style={styles.button}><Text style={styles.buttonText}>Back to room</Text></Pressable>
        </View> : snapshot.game_type === 'flush' ? <FlushTable key={snapshot.match_id} snapshot={visibleSnapshot || snapshot} busy={busy} error={error}
          social={{ connected, phrases: personal.phrases, save: personal.save, send: text => social.send(snapshot.match_id!, null, text) }}
          onSave={payload => lobbyAction('/flush-settings', payload)} onStart={rules_revision => lobbyAction('/start', { rules_revision })}
          onAction={gameAction} onBack={collapseGame} onNewGame={() => { setLive(false); setOpen(true); }} lobbyControl={leaveControl}
          endControl={snapshot.is_creator && !canCreate ? <EndGameControl table compact busy={busy} onEnd={() => lobbyAction('/end')} /> : null} />
        : snapshot.game_type === 'marriage' ? <MarriageTable key={snapshot.match_id} snapshot={visibleSnapshot || snapshot} busy={busy} error={error} lobbyControl={leaveControl} onSave={scoring => lobbyAction('/marriage-settings', { scoring })}
          onAction={gameAction} onStart={() => lobbyAction('/start', { play_mode: 'manual' })} onBack={collapseGame}
          onNewGame={() => { setLive(false); setOpen(true); }} endControl={snapshot.is_creator && !canCreate ? <EndGameControl compact busy={busy} onEnd={() => lobbyAction('/end')} /> : null}
          social={{ connected, phrases: personal.phrases, save: personal.save, send: (recipient, text) => social.send(snapshot.match_id!, recipient, text) }} />
        : <LiveGameTable endControl={snapshot.is_creator && !canCreate ? <EndGameControl compact busy={busy} onEnd={() => lobbyAction('/end')} /> : null} onNextDeal={() => lobbyAction('/next-deal', { deal_number: snapshot.round_review?.deal_number })} key={snapshot.match_id} snapshot={visibleSnapshot || snapshot} busy={busy} error={error} onAction={gameAction} onNewGame={() => { setCapacity(snapshot.capacity === 5 ? 5 : 4); setLive(false); setOpen(true); }} onStart={() => lobbyAction('/start', { play_mode: 'manual' })} onSave={settings => lobbyAction('/settings', settings)} onBack={collapseGame}
          social={{ connected, phrases: personal.phrases, save: personal.save, send: (recipient, text) => social.send(snapshot.match_id!, recipient, text) }} />}
        <PokeOverlay pokes={pokes} matchId={snapshot.match_id} />
      </View></View> :
      <View style={styles.overlay}><View accessibilityViewIsModal style={styles.modal}>
        <ScrollView contentContainerStyle={styles.body}>
          <Text accessibilityRole="header" style={styles.title}>{snapshot?.status === 'finished' ? `Start a new ${gameName} ${noun}` : canCreate ? `Create a ${gameName} ${noun}` : snapshot?.can_join ? `Join this ${gameName} ${noun}` : `${gameName} ${noun}`}</Text>
          <Text style={styles.text}>{summary}</Text>
          {endControl}
          {leaveControl}
          {!connected && <Text accessibilityRole="alert" style={styles.modalError}>{connectionMessage || 'Reconnecting… Your seat is saved.'}</Text>}
          {snapshot?.can_join && <>
            <Text style={styles.text}>{(snapshot.capacity || 0) - (snapshot.players?.length || 0)} seats available. Take a seat to play with this room.</Text>
            <Pressable accessibilityRole="button" disabled={busy} accessibilityState={{ disabled: busy }} onPress={() => act(true)} style={styles.button}><Text style={styles.buttonText}>{`Join ${noun}`}</Text></Pressable>
          </>}
          <View style={styles.codePanel}>
            <Text style={styles.text}>Table code</Text>
            <Text selectable accessibilityLabel={`Table code ${roomId}`} style={styles.code}>{roomId}</Text>
            <Text style={styles.note}>Share this code. Friends can paste it into “Table code / room ID” on the room list, enter the room, then choose “Join {noun}”.</Text>
          </View>
          {!!error && <Text accessibilityRole="alert" style={styles.modalError}>{error}</Text>}
          {!!snapshot?.error && <Text accessibilityRole="alert" style={styles.modalError}>{snapshot.error}</Text>}
          {canCreate ? <>
            <Text style={styles.text}>{gameType === 'flush' ? '2–10 players · the creator locks the seated roster when ready.' : 'Players'}</Text>
            <View style={[styles.choices, { flexWrap: 'wrap' }]}>{(gameType === 'flush' ? [] : gameType !== 'callbreak' ? [2, 3, 4, 5] : [4, 5]).map(size => <Pressable key={size} accessibilityRole="button" accessibilityState={{ selected: capacity === size }}
              onPress={() => setCapacity(size)} style={[styles.choice, size === capacity && { borderColor: colors.accent }]}>
              <Text style={styles.text}>{size} players</Text>
            </Pressable>)}</View>
            <Pressable accessibilityRole="button" disabled={busy} accessibilityState={{ disabled: busy }} onPress={() => act(false)} style={styles.button}><Text style={styles.buttonText}>Create {gameName} {createNoun}</Text></Pressable>
          </> : <>
            {snapshot?.players?.map(player => <Text key={player.player_id} style={styles.player}>Seat {player.player_id} · {player.player_id === snapshot.your_player_id ? 'You' : player.display_name || `Player ${player.player_id}`}</Text>)}
            {!!snapshot?.your_player_id && <Text style={styles.text}>You are seated as player {snapshot.your_player_id}.</Text>}
            {snapshot?.status === 'waiting' && <Text style={styles.text}>{snapshot.game_type === 'flush' ? 'At least 2 players are required. The creator can lock the table with the players currently seated; seating reopens after the round.' : `Waiting for ${(snapshot.capacity || 0) - (snapshot.players?.length || 0)} more players. The table opens when all seats are filled. The creator then starts the ${noun}.`}</Text>}
            {snapshot?.status === 'playing' && !snapshot.your_player_id && <Text style={styles.text}>The game is full. You are watching its status.</Text>}
          </>}
          <Text style={styles.note}>{gameName === 'Flush' ? 'Three private cards each. Review chip and blind/seen rules before starting. Rules lock for the round; show requires the final two players.' : gameName === 'Marriage' ? '21 cards each. Each player makes their own moves; turns wait until the player acts. Complete seven Dublees and an eighth pair to win. Normal qualification is available; normal-hand winning comes later. Set scoring rules at the table before starting.' : 'The creator can set rules and placement bets at the table before starting. Each player confirms their own bids and card choices. Turns have no time limit.'}</Text>
          <Pressable accessibilityRole="button" onPress={() => setOpen(false)} style={styles.choice}><Text style={styles.text}>Back to room</Text></Pressable>
        </ScrollView>
      </View></View>}
    </Modal>
  </>;
}
const createStyles = (colors: ThemeColors) => StyleSheet.create({
  invitation: { backgroundColor: colors.surfaceSelected, borderWidth: 1, borderColor: colors.accent, borderRadius: 16, padding: 20, gap: 12, marginBottom: 20 },
  roomCard: { backgroundColor: colors.surface, borderRadius: 16, padding: 24, gap: 8, marginBottom: 20 },
  sectionToggle: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  connectionNotice: { padding: 10, color: colors.accent, backgroundColor: colors.surfaceSelected, fontFamily: fonts.medium, fontSize: 12 },
  returnPanel: { gap: 10, padding: 14, marginTop: 16, borderWidth: 1, borderColor: colors.accent, borderRadius: 12 },
  notified: { borderWidth: 2, borderColor: colors.turnText, backgroundColor: colors.turnSurface },
  bidNotice: { padding: 14, gap: 10, borderRadius: 10, borderWidth: 1, borderColor: colors.accent, backgroundColor: colors.surfaceSelected },
  liveBackdrop: { flex: 1, backgroundColor: colors.overlay, alignItems: 'center', justifyContent: 'center' },
  liveOverlay: { width: '100%', height: '100%', overflow: 'hidden', backgroundColor: colors.background },
  codePanel: { padding: 16, borderRadius: 10, backgroundColor: colors.surface, gap: 8 },
  code: { fontFamily: fonts.medium, fontSize: 22, color: colors.text, letterSpacing: 1 },
  joinHint: { fontFamily: fonts.body, fontSize: 12, lineHeight: 21, color: colors.textMuted, marginTop: 8 },
  bar: { gap: 18, paddingTop: 24, paddingBottom: 8 }, summary: { color: colors.text, fontFamily: fonts.medium, fontSize: 14, lineHeight: 23 },
  button: { minHeight: 44, padding: 12, borderRadius: 8, backgroundColor: colors.surfaceSelected, alignItems: 'center', justifyContent: 'center' }, buttonText: { fontFamily: fonts.medium, fontSize: 12, color: colors.text },
  error: { color: colors.danger, padding: 12, fontFamily: fonts.body, fontSize: 12 }, overlay: { flex: 1, paddingHorizontal: 20, paddingVertical: 48, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.overlay }, modal: { maxWidth: 480, width: '100%', maxHeight: '100%', borderRadius: 18, backgroundColor: colors.surface }, body: { padding: 24, gap: 16 },
  title: { fontFamily: fonts.display, fontSize: 30, color: colors.text }, text: { fontFamily: fonts.body, color: colors.text, fontSize: 13, lineHeight: 22 }, choices: { flexDirection: 'row', gap: 12 }, choice: { minHeight: 44, padding: 10, borderWidth: 1, borderColor: colors.border, borderRadius: 8, alignItems: 'center', justifyContent: 'center' }, player: { fontFamily: fonts.medium, fontSize: 13, color: colors.text }, note: { fontFamily: fonts.body, color: colors.textMuted, fontSize: 11, lineHeight: 19 }, modalError: { fontFamily: fonts.body, color: colors.danger, fontSize: 12 },
});
