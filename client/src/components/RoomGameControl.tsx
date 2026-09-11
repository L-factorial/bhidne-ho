import { useEffect, useRef, useState } from 'react';
import { Animated, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useGameNotification } from '../notifications/useGameNotification';
import { colors, fonts } from '../theme';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LiveGameTable, RoomSnapshot as Snapshot } from '../screens/LiveGameTable';


export function RoomGameControl({ roomId, apiUrl, token, connected, members, connectionMessage }: {
  roomId: string; apiUrl: string; token: string; connected: boolean; members: string[]; connectionMessage?: string;
}) {
  const insets = useSafeAreaInsets();
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [open, setOpen] = useState(false);
  const [live, setLive] = useState(false);
  const collapsed = !open && live && !!snapshot && snapshot.status !== 'empty';
  const notification = useGameNotification(snapshot, collapsed);
  function collapseGame() { notification.prepare(); setOpen(false); }
  const enteredMatch = useRef<string | null>(null);
  const [capacity, setCapacity] = useState<4 | 5>(4);
  const [pendingAction, setBusy] = useState(false);
  const [synced, setSynced] = useState(false);
  const busy = pendingAction || !connected || !synced;
  const [actionError, setError] = useState('');
  const [refreshError, setRefreshError] = useState('');
  const error = actionError || refreshError;
  const generation = useRef(0), pending = useRef(false);
  const alive = useRef(true);
  const requests = useRef(new Set<AbortController>());
  const offeredMatch = useRef<string | null>(null);
  const canSend = useRef(false);
  canSend.current = connected && synced;
  const visibleSnapshot = snapshot ? { ...snapshot, players: snapshot.players?.map(player => ({
    ...player, connected: members.includes(player.user_id) && (player.player_id !== snapshot.your_player_id || connected),
  })) } : null;
  useEffect(() => {
    if (snapshot?.can_join && snapshot.match_id && offeredMatch.current !== snapshot.match_id) {
      offeredMatch.current = snapshot.match_id;
      setOpen(true);
    }
  }, [snapshot?.can_join, snapshot?.match_id]);
  const base = `${apiUrl}/test-games/${encodeURIComponent(roomId)}`;
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
    const timeout = setTimeout(abort, 10000);
    try {
      const response = await fetch(base + suffix, { method: body ? 'POST' : 'GET', signal: controller.signal,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}) });
      const data = await response.json();
      if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'Game request failed. Try again.');
      return data;
    } finally {
      clearTimeout(timeout); signal?.removeEventListener('abort', abort); requests.current.delete(controller);
    }
  }

  useEffect(() => {
    alive.current = true;
    setSynced(false);
    if (connected) setError('');
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      const version = generation.current;
      try {
        if (!pending.current) {
          const data = await api('', undefined, controller.signal);
          if (!controller.signal.aborted && generation.current === version) {
            setSnapshot(data); setRefreshError(''); setSynced(true);
          }
        }
      } catch (error) {
        if (!controller.signal.aborted && generation.current === version) {
          const message = error instanceof Error ? error.message : 'Cannot load game.';
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
  }, [base, token, connected]);
  async function act(join: boolean) {
    if (!canSend.current || pending.current) return;
    pending.current = true; const version = ++generation.current; setBusy(true); setError('');
    try {
      const data = await api(join ? '/join' : '', join ? { match_id: snapshot?.match_id } : { player_count: capacity });
      if (alive.current && generation.current === version) { setSnapshot(data); setOpen(true); }
    } catch (error) { if (alive.current && generation.current === version) setError(error instanceof Error ? error.message : 'Cannot update game.'); }
    finally { pending.current = false; if (alive.current) setBusy(false); }
  }
  const canCreate = snapshot?.status === 'empty' || snapshot?.status === 'finished';
  async function gameAction(command: string, payload: object = {}) {
    if (!canSend.current || !snapshot?.game || pending.current) return;
    pending.current = true; const version = ++generation.current; setBusy(true); setError('');
    try {
      const data = await api('/action', { match_id: snapshot.match_id, expected_revision: snapshot.game.revision, command, payload });
      if (alive.current && generation.current === version) setSnapshot(data);
    } catch (error) { if (alive.current && generation.current === version) setError(error instanceof Error ? error.message : 'Action failed.'); }
    finally { pending.current = false; if (alive.current) setBusy(false); }
  }
  async function lobbyAction(suffix: string, payload: object = {}) {
    if (!canSend.current || !snapshot || pending.current) return;
    pending.current = true; const version = ++generation.current; setBusy(true); setError('');
    try {
      const data = await api(suffix, { match_id: snapshot.match_id, ...payload });
      if (alive.current && generation.current === version) setSnapshot(data);
    } catch (error) { if (alive.current && generation.current === version) setError(error instanceof Error ? error.message : 'Could not update game.'); }
    finally { pending.current = false; if (alive.current) setBusy(false); }
  }
  const actionLabel = !snapshot ? 'Loading game…' : snapshot.status === 'finished' ? 'Start a new game' : canCreate ? 'Create game'
    : snapshot.can_join ? 'Join game' : snapshot.your_player_id ? 'Enter game' : 'Watch game';
  const summary = !snapshot ? 'Loading room game…' : snapshot.status === 'empty' ? 'No game yet. Create one for everyone in this room.'
    : snapshot.status === 'waiting' ? `Call Break · ${snapshot.players?.length}/${snapshot.capacity} players ready`
    : snapshot.status === 'finished' ? 'Call Break · Game finished' : `Call Break · ${snapshot.game?.phase.replaceAll('_', ' ').toLowerCase() || 'In progress'}`;
  return <>
    {collapsed && <View style={styles.returnPanel}>
      <Animated.View style={{ opacity: notification.opacity }}>
        <Pressable accessibilityRole="button" accessibilityLabel="Go back to game" onPress={() => setOpen(true)} style={[styles.button, !!notification.notice && styles.notified]}>
          <Text style={styles.buttonText}>{notification.notice ? '✦ ' : ''}Go back to game</Text>
        </Pressable>
      </Animated.View>
      {!!notification.notice && <Text accessibilityLiveRegion="polite" style={styles.text}>{notification.notice}</Text>}
      <Pressable accessibilityRole="button" accessibilityLabel={notification.muted ? 'Unmute game notifications' : 'Mute game notifications'} onPress={notification.toggleSound} style={styles.choice}><Text style={styles.note}>{notification.muted ? 'Sound off' : 'Sound on · pong'}</Text></Pressable>
    </View>}
    <View style={styles.bar}>
      <View style={{ flex: 1, minWidth: 150 }}>
        <Text style={styles.summary}>{summary}</Text>
        {snapshot?.status === 'waiting' && <Text style={styles.joinHint}>{snapshot.your_player_id
          ? `Your seat: player ${snapshot.your_player_id}. Waiting for other players.`
          : 'You are in the room. Join the game to take a seat.'}</Text>}
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel={actionLabel} disabled={!snapshot || busy}
        accessibilityState={{ disabled: !snapshot || busy }}
        onPress={() => { if (snapshot?.can_join) void act(true); else { setLive(!!snapshot && !canCreate); setOpen(true); } }}
        style={[styles.button, (!snapshot || busy) && { opacity: 0.5 }]}>
        <Text style={styles.buttonText}>{busy ? 'Joining…' : actionLabel}</Text>
      </Pressable>
    </View>
    {!collapsed && !open && snapshot?.game?.phase === 'BIDDING' && !!snapshot.your_player_id && <View style={styles.bidNotice}>
      <Text accessibilityRole="alert" accessibilityLiveRegion="assertive" style={styles.text}>Deal {snapshot.deal?.deal_number} · {snapshot.game.turn.player_id === snapshot.your_player_id ? 'Your turn to bid' : 'Bidding is open'}</Text>
      <Pressable accessibilityRole="button" onPress={() => { setLive(true); setOpen(true); }} style={styles.button}><Text style={styles.buttonText}>View cards & bidding</Text></Pressable>
    </View>}
    {snapshot?.status === 'finished' && <Pressable accessibilityRole="button" onPress={() => { setLive(true); setOpen(true); }} style={styles.choice}><Text style={styles.text}>View final scores</Text></Pressable>}
    {!!error && !open && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
    <Modal transparent visible={open} animationType="fade" onRequestClose={collapseGame}>
      {live && snapshot ? <View testID="live-game-backdrop" style={[styles.liveBackdrop, {
        paddingTop: insets.top, paddingBottom: insets.bottom,
        paddingLeft: insets.left, paddingRight: insets.right,
      }]}><View accessibilityViewIsModal testID="live-game-overlay" style={styles.liveOverlay}>
        {(!connected || !synced) && <Text accessibilityRole="alert" style={styles.connectionNotice}>{connectionMessage || (!connected ? 'Reconnecting… Your seat is saved.' : 'Updating game…')}</Text>}
        <LiveGameTable snapshot={visibleSnapshot || snapshot} busy={busy} error={error} onAction={gameAction} onNewGame={() => { setCapacity(snapshot.capacity === 5 ? 5 : 4); setLive(false); setOpen(true); }} onStart={play_mode => lobbyAction('/start', { play_mode })} onSave={settings => lobbyAction('/settings', settings)} onBack={collapseGame} />
      </View></View> :
      <View style={styles.overlay}><View accessibilityViewIsModal style={styles.modal}>
        <ScrollView contentContainerStyle={styles.body}>
          <Text accessibilityRole="header" style={styles.title}>{snapshot?.status === 'finished' ? 'Start a new Call Break game' : canCreate ? 'Create a Call Break game' : snapshot?.can_join ? 'Join this Call Break game' : 'Call Break game'}</Text>
          <Text style={styles.text}>{summary}</Text>
          {!connected && <Text accessibilityRole="alert" style={styles.modalError}>{connectionMessage || 'Reconnecting… Your seat is saved.'}</Text>}
          {snapshot?.can_join && <>
            <Text style={styles.text}>{(snapshot.capacity || 0) - (snapshot.players?.length || 0)} seats available. Take a seat to play with this room.</Text>
            <Pressable accessibilityRole="button" disabled={busy} accessibilityState={{ disabled: busy }} onPress={() => act(true)} style={styles.button}><Text style={styles.buttonText}>Join game</Text></Pressable>
          </>}
          <View style={styles.codePanel}>
            <Text style={styles.text}>Table code</Text>
            <Text selectable accessibilityLabel={`Table code ${roomId}`} style={styles.code}>{roomId}</Text>
            <Text style={styles.note}>Share this code. Friends can paste it into “Table code / room ID” on the room list, enter the room, then choose “Join game”.</Text>
          </View>
          {!!error && <Text accessibilityRole="alert" style={styles.modalError}>{error}</Text>}
          {!!snapshot?.error && <Text accessibilityRole="alert" style={styles.modalError}>{snapshot.error}</Text>}
          {canCreate ? <>
            <Text style={styles.text}>Players</Text>
            <View style={styles.choices}>{([4, 5] as const).map(size => <Pressable key={size} accessibilityRole="button" accessibilityState={{ selected: capacity === size }}
              onPress={() => setCapacity(size)} style={[styles.choice, size === capacity && { borderColor: colors.copper }]}>
              <Text style={styles.text}>{size} players</Text>
            </Pressable>)}</View>
            <Pressable accessibilityRole="button" disabled={busy} accessibilityState={{ disabled: busy }} onPress={() => act(false)} style={styles.button}><Text style={styles.buttonText}>Create Call Break game</Text></Pressable>
          </> : <>
            {snapshot?.players?.map(player => <Text key={player.player_id} style={styles.player}>Seat {player.player_id} · {player.player_id === snapshot.your_player_id ? 'You' : `Player ${player.player_id}`}</Text>)}
            {!!snapshot?.your_player_id && <Text style={styles.text}>You are seated as player {snapshot.your_player_id}.</Text>}
            {snapshot?.status === 'waiting' && <Text style={styles.text}>Waiting for {(snapshot.capacity || 0) - (snapshot.players?.length || 0)} more players. The table opens when all seats are filled. The creator then starts the game.</Text>}
            {snapshot?.status === 'playing' && !snapshot.your_player_id && <Text style={styles.text}>The game is full. You are watching its status.</Text>}
          </>}
          <Text style={styles.note}>The creator can set rules and placement bets at the table before starting. Choose Player play for manual bids and card selection, or Autoplay for three-second automatic turns.</Text>
          <Pressable accessibilityRole="button" onPress={() => setOpen(false)} style={styles.choice}><Text style={styles.text}>Back to room</Text></Pressable>
        </ScrollView>
      </View></View>}
    </Modal>
  </>;
}
const styles = StyleSheet.create({
  connectionNotice: { padding: 10, color: '#FFE6AA', backgroundColor: '#29475B', fontFamily: fonts.medium, fontSize: 12 },
  returnPanel: { gap: 10, padding: 14, marginTop: 16, borderWidth: 1, borderColor: colors.copper, borderRadius: 12 },
  notified: { borderWidth: 2, borderColor: '#FFE6AA', backgroundColor: '#996039' },
  bidNotice: { padding: 14, gap: 10, borderRadius: 10, borderWidth: 1, borderColor: '#247BA0', backgroundColor: '#E2F2FA' },
  liveBackdrop: { flex: 1, backgroundColor: '#020A14CC', alignItems: 'center', justifyContent: 'center' },
  liveOverlay: { width: '100%', height: '100%', overflow: 'hidden', backgroundColor: colors.navy },
  codePanel: { padding: 16, borderRadius: 10, backgroundColor: '#EEE7DD', gap: 8 },
  code: { fontFamily: fonts.medium, fontSize: 22, color: colors.ink, letterSpacing: 1 },
  joinHint: { fontFamily: fonts.body, fontSize: 12, lineHeight: 21, color: colors.muted, marginTop: 8 },
  bar: { gap: 18, paddingTop: 24, paddingBottom: 8 }, summary: { color: colors.ink, fontFamily: fonts.medium, fontSize: 14, lineHeight: 23 },
  button: { minHeight: 44, padding: 12, borderRadius: 8, backgroundColor: colors.copper, alignItems: 'center', justifyContent: 'center' }, buttonText: { fontFamily: fonts.medium, fontSize: 12, color: colors.ivory },
  error: { color: '#A33332', padding: 12, fontFamily: fonts.body, fontSize: 12 }, overlay: { flex: 1, paddingHorizontal: 20, paddingVertical: 48, justifyContent: 'center', alignItems: 'center', backgroundColor: '#020A14BB' }, modal: { maxWidth: 480, width: '100%', maxHeight: '100%', borderRadius: 18, backgroundColor: colors.ivory }, body: { padding: 24, gap: 16 },
  title: { fontFamily: fonts.display, fontSize: 30, color: colors.ink }, text: { fontFamily: fonts.body, color: colors.ink, fontSize: 13, lineHeight: 22 }, choices: { flexDirection: 'row', gap: 12 }, choice: { minHeight: 44, padding: 10, borderWidth: 1, borderColor: colors.line, borderRadius: 8, alignItems: 'center', justifyContent: 'center' }, player: { fontFamily: fonts.medium, fontSize: 13, color: colors.ink }, note: { fontFamily: fonts.body, color: colors.muted, fontSize: 11, lineHeight: 19 }, modalError: { fontFamily: fonts.body, color: '#A33332', fontSize: 12 },
});
