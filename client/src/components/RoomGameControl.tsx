import { gameControlFinish, gameHeadingFinish, gamePanelFinish, fonts, ThemeContext, useTheme, useThemedStyles, type ThemeColors } from '../theme';
import { useTableTheme } from '../TableThemeProvider';
import { FormInput, FormScrollView } from './FormInput';
import { KeyboardFrame } from './KeyboardFrame';
import { FormFooter } from './FormFooter';
import { TableSocialProvider } from './TableSocial';
import type { TableSocialChannel } from '../multiplayer/TableSocialChannel';
import { TableCard } from './TableCard';
import type { TableEntry } from '../multiplayer/tableNavigation';
import { RuleProposal } from './RuleProposal';
import { TableControls } from './TableControls';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Modal, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useGameNotification } from '../notifications/useGameNotification';
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
import { GameRequestError, type GameRequestDetail } from '../multiplayer/PendingGameAction';
import { request } from '../multiplayer/api';

type InvitePlayer = { user_id: string; display_name: string; username?: string | null; eligible?: boolean; reason?: string | null };

export function RoomGameControl({ socialChannel, chat, onOpenChange, requestedMatchId, requestedEntry, roomId, apiUrl, token, connected, sessionActive = true, members, roomMembers = members, connectionMessage, userId, pokes, personal, createContent, creationEnabled = true, gameType = 'callbreak' }: {
  socialChannel?: TableSocialChannel; chat?: ReactNode; onOpenChange?: (open: boolean) => void;
  requestedMatchId?: string; requestedEntry?: TableEntry;
  gameType?: 'callbreak' | 'marriage' | 'flush';
  createContent?: ReactNode; creationEnabled?: boolean;
  userId: string; pokes: RoomPoke[]; personal: ReturnType<typeof usePlayerPhrases>;
  roomId: string; apiUrl: string; token: string; connected: boolean; sessionActive?: boolean; members: string[]; roomMembers?: string[]; connectionMessage?: string;
}) {
  const { colors } = useTheme();
  const { theme: gameTheme } = useTableTheme();
  const styles = useThemedStyles(createStyles);
  const mobile = useWindowDimensions().width < 900;
  const insets = useSafeAreaInsets();
  const social = useRoomPokes(roomId, userId, token, connected);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [open, setOpen] = useState(false);
  const [seatConflict, setSeatConflict] = useState<GameRequestDetail | null>(null);
  const visibleTables = snapshot?.tables?.filter(table => table.status !== 'ended' && table.phase !== 'ENDED') || [];
  useEffect(() => { onOpenChange?.(open); }, [open, onOpenChange]);
  useEffect(() => () => onOpenChange?.(false), [onOpenChange]);
  const [live, setLive] = useState(false);
  const collapsed = !open && live && !!snapshot && snapshot.status !== 'empty';
  const notification = useGameNotification(snapshot, collapsed);
  function collapseGame() { notification.prepare(); setOpen(false); }
  const [capacity, setCapacity] = useState(4);
  const [tableName, setTableName] = useState('');
  const [inviteQuery, setInviteQuery] = useState('');
  const [inviteResults, setInviteResults] = useState<InvitePlayer[]>([]);
  const [selectedInvitees, setSelectedInvitees] = useState<InvitePlayer[]>([]);
  const [inviteError, setInviteError] = useState('');
  const [searchingPlayers, setSearchingPlayers] = useState(false);
  useEffect(() => { if (gameType === 'callbreak') setCapacity(value => Math.max(4, value)); }, [gameType]);
  const [pendingAction, setBusy] = useState(false);
  const [formationBlocked, setFormationBlocked] = useState(false);
  const base = `${apiUrl}/test-games/${encodeURIComponent(roomId)}`;
  const selectedMatch = useRef<string | undefined>(requestedMatchId);
  const transport = useMemo(() => createHttpGameTransport<Snapshot>(base, token, globalThis.fetch, () => selectedMatch.current), [base, token]);
  useEffect(() => {
    if (requestedMatchId) { selectedMatch.current = requestedMatchId; setActionTick(v => v + 1); }
  }, [requestedMatchId]);
  const commandClient = useMemo(() => new GameCommandClient(transport), [transport]);
  const [actionTick, setActionTick] = useState(0);
  const [actionNotice, setActionNotice] = useState('');
  const [synced, setSynced] = useState(false);
  // HTTP table operations use durable room membership. Chat/presence socket
  // readiness must not prevent the first snapshot or freeze table creation.
  const busy = pendingAction || !sessionActive || !synced;
  const [actionError, setError] = useState('');
  const [refreshError, setRefreshError] = useState('');
  const error = actionError || refreshError;
  useEffect(() => {
    if (seatConflict?.room_id === roomId && snapshot?.tables && !snapshot.tables.some(table =>
      table.match_id === seatConflict.match_id && table.status !== 'ended' && table.phase !== 'ENDED')) {
      setSeatConflict(null);
      setError('The previous table has ended. You can now take a seat here.');
    }
  }, [snapshot?.tables, seatConflict, roomId]);
  const generation = useRef(0), pending = useRef(false);
  const alive = useRef(true);
  const requests = useRef(new Set<AbortController>());
  const canSend = useRef(false);
  canSend.current = sessionActive && synced && !commandClient.pending;
  const visibleSnapshot = snapshot ? { ...snapshot, players: snapshot.players?.map(player => ({
    ...player, connected: members.includes(player.user_id) && (player.player_id !== snapshot.your_player_id || connected),
  })) } : null;
  const openedInvitation = useRef<string | null>(null);
  useEffect(() => {
    if ((!requestedEntry || requestedEntry === 'watch') && requestedMatchId && snapshot?.match_id === requestedMatchId && snapshot.status !== 'ended' && openedInvitation.current !== requestedMatchId) {
      openedInvitation.current = requestedMatchId; setLive(true); setOpen(true);
    }
  }, [requestedMatchId, requestedEntry, snapshot?.match_id, snapshot?.status]);
  useEffect(() => {
    if (snapshot?.status === 'ended') {
      selectedMatch.current = undefined;
      setLive(false); setOpen(false);
    }
  }, [snapshot?.status, snapshot?.match_id]);
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
          setRefreshError(message);
        }
      }
      finally { if (!controller.signal.aborted) timer = setTimeout(refresh, 1000); }
    }
    if (sessionActive) refresh();
    return () => {
      alive.current = false; generation.current++; controller.abort(); clearTimeout(timer);
      requests.current.forEach(request => request.abort());
    };
  }, [commandClient, sessionActive, actionTick]);
  async function returnToGame() {
    if (busy || pending.current) return;
    pending.current = true; const version = ++generation.current; setBusy(true); setError('');
    try {
      const data = await api(selectedMatch.current ? `?match_id=${encodeURIComponent(selectedMatch.current)}` : '');
      if (alive.current && generation.current === version) {
        setSnapshot(data); setLive(data.status !== 'empty'); setOpen(true);
      }
    } catch (error) {
      if (alive.current) setError(error instanceof Error ? error.message : 'Could not restore game.');
    } finally { pending.current = false; if (alive.current) setBusy(false); }
  }
  async function act(join: boolean) {
    if (!canSend.current || pending.current) return;
    if (!join && !tableName.trim()) { setError('Enter a table name.'); return; }
    pending.current = true; const version = ++generation.current; setBusy(true); setError('');
    try {
      const data = await api(join ? '/join' : '', join ? { match_id: snapshot?.match_id } : { player_count: gameType === 'flush' ? 10 : capacity, game_type: gameType, name: tableName.trim(), invitees: selectedInvitees.map(player => player.user_id) });
      if (alive.current && generation.current === version) {
        selectedMatch.current = data.match_id;
        setSnapshot(data); setLive(true); setOpen(true);
        if (!join) { setTableName(''); setSelectedInvitees([]); setInviteQuery(''); setInviteResults([]); }
      }
    } catch (error) {
      if (alive.current && generation.current === version) {
        if (error instanceof GameRequestError && error.detail?.code === 'PLAYER_ALREADY_AT_TABLE') {
          setSeatConflict(error.detail); setOpen(false);
        }
        setError(error instanceof Error ? error.message : 'Cannot update game.');
      }
    }
    finally { pending.current = false; if (alive.current) setBusy(false); }
  }
  async function leavePreviousTable() {
    if (!seatConflict?.room_id || !seatConflict.match_id || pending.current) return;
    pending.current = true; setBusy(true); setError('');
    try {
      if (seatConflict.departure_command === 'end') {
        const previous = await request<Snapshot>(`/test-games/${encodeURIComponent(seatConflict.room_id)}?match_id=${encodeURIComponent(seatConflict.match_id)}`,
          { user_id: userId, token });
        if (previous.match_id !== seatConflict.match_id || previous.status !== 'ended') {
          setError('The previous table is still reserved. Its creator must end it before you can take another seat.');
          return;
        }
        setSeatConflict(null);
        setError('The previous table has ended. You can now take a seat here.');
        return;
      }
      const command = seatConflict.departure_command === 'abandon' ? 'table/abandon' : 'leave';
      await request(`/test-games/${encodeURIComponent(seatConflict.room_id)}/${command}`,
        { user_id: userId, token }, { match_id: seatConflict.match_id });
      setSeatConflict(null);
      setError('Previous table left. You can now take a seat here.');
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not leave the previous table.');
    } finally { pending.current = false; setBusy(false); }
  }
  const mobileGame = mobile;
  const canCreate = snapshot?.status === 'empty' || (snapshot?.status === 'finished' && !snapshot.table?.requires_replacement) || snapshot?.status === 'ended';
  const canEnd = !canCreate && (snapshot?.is_creator || (connected && roomMembers.length === 1 && roomMembers[0] === userId));
  const selectedGameName = ({ marriage: 'Marriage', callbreak: 'Call Break', flush: 'Flush' })[gameType];
  const gameName = ({ marriage: 'Marriage', callbreak: 'Call Break', flush: 'Flush' })[(canCreate ? gameType : snapshot?.game_type) || 'callbreak'];
  const noun = (canCreate ? gameType : snapshot?.game_type) === 'flush' ? 'table' : 'game';
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
        selectedMatch.current = data.match_id; setSnapshot(data);
        if (suffix === '/leave' || suffix === '/table/leave-seat' || suffix === '/table/abandon') { setOpen(false); setLive(false); }
      }
    } catch (error) { if (alive.current && generation.current === version) setError(error instanceof Error ? error.message : 'Could not update game.'); }
    finally { pending.current = false; if (alive.current) setBusy(false); }
  }
  const endControl = canEnd
    ? <EndGameControl table={snapshot?.game_type === 'flush'} key={`end-${snapshot?.match_id}`} busy={busy} onEnd={() => lobbyAction('/end')} /> : null;
  const lifecycleControl = snapshot?.table ? <TableControls menuSection="manage" table={snapshot.table} members={roomMembers} userId={userId} busy={busy} formationBlocked={formationBlocked}
    act={(command, payload) => lobbyAction(`/table/${command}`, payload)}
    start={() => lobbyAction('/start', { play_mode: 'manual', rules_revision: snapshot.flush_settings?.rules_revision })} /> : null;
  const menuLeaveControl = snapshot?.table ? <TableControls menuSection="leave" table={snapshot.table} members={roomMembers} userId={userId} busy={busy}
    act={(command, payload) => lobbyAction(`/table/${command}`, payload)} start={() => lobbyAction('/start')} /> : null;
  const leaveControl = !snapshot?.table?.current_user.can_leave_seat && !snapshot?.table?.current_user.can_abandon_match && snapshot?.your_player_id
    ? <Pressable accessibilityRole="button" accessibilityLabel={snapshot.game_type === 'flush' || snapshot.game_type === 'marriage' ? 'Leave Table' : `Leave ${noun}`} disabled={busy} accessibilityState={{ disabled: busy }} onPress={() => void lobbyAction('/leave')} style={{ minHeight: 44, padding: 10, justifyContent: 'center' }}><Text style={[styles.text, live && open && { color: colors.text }, { color: colors.danger }]}>{snapshot.game_type === 'flush' || snapshot.game_type === 'marriage' ? 'Leave Table' : `Leave ${noun}`}</Text></Pressable> : null;
  const ruleReview = snapshot?.rule_proposal && <RuleProposal key={snapshot.rule_proposal.id} proposal={snapshot.rule_proposal} busy={busy} vote={accept => void lobbyAction('/rule-vote', { proposal_id: snapshot.rule_proposal!.id, accept })} />;
  async function eligiblePlayers(players: InvitePlayer[], signal?: AbortSignal) {
    if (!players.length) return [];
    const eligibility = await request<{ user_id: string; eligible: boolean; reason?: string | null }[]>(
      `/test-games/${encodeURIComponent(roomId)}/invitations/eligibility`, { user_id: userId, token },
      { player_ids: players.map(player => player.user_id) }, signal);
    return players.map(player => ({ ...player, ...eligibility.find(item => item.user_id === player.user_id) }));
  }
  useEffect(() => {
    if (!open || live || inviteQuery.trim().length < 2) { setInviteResults([]); return; }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const players = await request<InvitePlayer[]>(`/players/search?q=${encodeURIComponent(inviteQuery.trim())}`, { user_id: userId, token }, undefined, controller.signal);
        setInviteResults(await eligiblePlayers(players, controller.signal)); setInviteError('');
      } catch (error) { if (!controller.signal.aborted) setInviteError(error instanceof Error ? error.message : 'Could not search recent players.'); }
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [inviteQuery, live, open, roomId, token, userId]);
  async function searchDirectory() {
    if (inviteQuery.trim().length < 2 || searchingPlayers) return;
    setSearchingPlayers(true); setInviteError('');
    try {
      const players = await request<InvitePlayer[]>(`/players/directory?q=${encodeURIComponent(inviteQuery.trim())}`, { user_id: userId, token });
      setInviteResults(await eligiblePlayers(players));
      if (!players.length) setInviteError('No player found with that exact name, username, or user ID.');
    } catch (error) { setInviteError(error instanceof Error ? error.message : 'Could not search the player directory.'); }
    finally { setSearchingPlayers(false); }
  }
  async function enterTable(matchId: string, action: TableEntry) {
    if (busy || pending.current) return;
    pending.current = true; const version = ++generation.current; setBusy(true); setError('');
    try {
      const data = await api(action === 'seat' ? '/join' : action === 'queue' ? '/table/join-queue' : `?match_id=${encodeURIComponent(matchId)}`,
        action === 'watch' ? undefined : { match_id: matchId });
      if (!alive.current || generation.current !== version) return;
      selectedMatch.current = data.match_id;
      setSnapshot(data); setLive(true); setOpen(true);
    } catch (failure) {
      if (!alive.current || generation.current !== version) return;
      setError(failure instanceof Error ? failure.message : 'Could not enter this table.');
      if (failure instanceof GameRequestError && failure.detail?.code === 'PLAYER_ALREADY_AT_TABLE') setSeatConflict(failure.detail);
    } finally {
      pending.current = false;
      if (alive.current) { setBusy(false); setActionTick(v => v + 1); }
    }
  }
  const enteredFromLobby = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!requestedMatchId || !requestedEntry || requestedEntry === 'watch' || busy || snapshot?.match_id !== requestedMatchId) return;
    const key = `${requestedMatchId}:${requestedEntry}`;
    if (enteredFromLobby.current === key) return;
    enteredFromLobby.current = key;
    void enterTable(requestedMatchId, requestedEntry);
  }, [requestedMatchId, requestedEntry, busy, snapshot?.match_id]);
  return <>
    {!snapshot && !refreshError && <Text accessibilityLiveRegion="polite" style={styles.text}>{sessionActive ? 'Loading tables…' : 'Sign in again to load tables.'}</Text>}
    {refreshError && <Pressable accessibilityRole="button" accessibilityLabel="Retry loading tables" disabled={pendingAction || !sessionActive}
      onPress={() => setActionTick(value => value + 1)} style={styles.choice}><Text style={styles.text}>Retry loading tables</Text></Pressable>}
    {!snapshot && <Pressable accessibilityRole="button" accessibilityLabel="Create table" disabled={pendingAction || !sessionActive || !creationEnabled}
      onPress={() => { setLive(false); setOpen(true); }} style={[styles.button, { backgroundColor: colors.primary, minHeight: 48 }]}>
      <Text style={[styles.buttonText, { color: colors.onPrimary }]}>+ Create table</Text>
    </Pressable>}
    {snapshot && !visibleTables.length && <View testID="room-empty-tables" style={{ flexGrow: 1, minHeight: 260, alignItems: 'center', justifyContent: 'center', paddingVertical: 32, gap: 24 }}>
      <Text style={[styles.text, { textAlign: 'center', maxWidth: 320, fontSize: 17, lineHeight: 26 }]}>No tables yet. Start a table and invite your friends.</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Create table" disabled={pendingAction || !sessionActive || !creationEnabled} accessibilityState={{ disabled: pendingAction || !sessionActive || !creationEnabled }} onPress={() => { setLive(false); setOpen(true); }} style={[styles.button, { backgroundColor: colors.primary, minHeight: 48, paddingHorizontal: 24, opacity: pendingAction || !sessionActive || !creationEnabled ? 0.5 : 1 }]}>
        <Text style={[styles.buttonText, { color: colors.onPrimary, fontSize: 15 }]}>+ Create table</Text>
      </Pressable>
    </View>}
    {visibleTables.map(table => <TableCard key={table.match_id} roomId={roomId} table={table} busy={busy} enter={action => void enterTable(table.match_id, action)} />)}
      {!!visibleTables.length && <Pressable accessibilityRole="button" accessibilityLabel="Create table" disabled={pendingAction || !sessionActive || !creationEnabled} onPress={() => { setLive(false); setOpen(true); }} style={[styles.button, { backgroundColor: colors.primary, minHeight: 52, marginBottom: 16 }]}>
        <Text style={[styles.buttonText, { color: colors.onPrimary }]}>+ Create New Table</Text>
      </Pressable>}
    {collapsed && !!notification.notice && <Animated.View style={{ opacity: notification.opacity }}>
      <Pressable accessibilityRole="button" onPress={() => void returnToGame()} style={styles.choice}><Text style={styles.text}>{notification.notice} · Return to table</Text></Pressable>
    </Animated.View>}
    {!!actionNotice && !open && <Text accessibilityLiveRegion="polite" style={styles.note}>{actionNotice}</Text>}
    {!!error && !open && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
    {!open && <PokeOverlay pokes={pokes} matchId={snapshot?.match_id} />}
    <Modal transparent visible={!!seatConflict} animationType="fade" onRequestClose={() => setSeatConflict(null)}>
      <View style={styles.overlay}><View accessibilityViewIsModal style={styles.modal}><View style={styles.body}>
        <Text accessibilityRole="header" style={styles.title}>{seatConflict?.departure_command === 'end' ? 'Previous table is reserved' : seatConflict?.departure_command === 'abandon' ? 'Abandon active game?' : 'Leave previous table?'}</Text>
        <Text style={styles.text}>You can visit this room, but each account can occupy only one table at a time.</Text>
        <Text style={styles.text}>{actionError}</Text>
        {seatConflict?.departure_command === 'end' && <Text style={styles.text}>Ask the creator to end the previous table. You do not need to leave it after it ends.</Text>}
        {seatConflict?.departure_command === 'abandon' && <Text style={styles.error}>Abandoning stops the active match for everyone at that table.</Text>}
        <Pressable accessibilityRole="button" disabled={pendingAction} onPress={() => void leavePreviousTable()} style={[styles.button, { backgroundColor: colors.dangerSurface, borderWidth: 1, borderColor: colors.danger }]}>
          <Text style={[styles.buttonText, { color: colors.danger }]}>{seatConflict?.departure_command === 'end' ? 'Check table status' : seatConflict?.departure_command === 'abandon' ? 'Abandon previous game' : 'Leave previous table'}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={() => setSeatConflict(null)} style={styles.choice}><Text style={styles.text}>Stay as observer</Text></Pressable>
      </View></View></View>
    </Modal>
    <Modal transparent visible={open} animationType="fade" onRequestClose={collapseGame}>
      {live && snapshot ? <View testID="live-game-backdrop" style={[styles.liveBackdrop, {
        backgroundColor: gameTheme.colors.background, paddingTop: insets.top, paddingBottom: insets.bottom,
        paddingLeft: insets.left, paddingRight: insets.right,
      }]}><View accessibilityViewIsModal testID="live-game-overlay" style={[styles.liveOverlay, (mobileGame || snapshot.game_type === 'flush') && !chat && { paddingBottom: 0 }]}>
        <ThemeContext.Provider value={gameTheme}><TableSocialProvider key={snapshot.match_id} snapshot={visibleSnapshot || snapshot} channel={socialChannel} connected={connected} userId={userId} pokes={pokes}>
        {snapshot.game_type === 'flush' ? <FlushTable connectionReady={connected && synced} onLock={() => void lobbyAction('/table/lock')} tableControl={<>{lifecycleControl}{snapshot.rule_proposal?.status !== 'PENDING' && ruleReview}</>} onFormationBlocked={setFormationBlocked} key={snapshot.match_id} snapshot={visibleSnapshot || snapshot} busy={busy} error={error}
          social={{ connected, phrases: personal.phrases, save: personal.save, send: text => social.send(snapshot.match_id!, null, text) }}
          onSave={payload => lobbyAction('/flush-settings', payload)} onStart={rules_revision => lobbyAction('/start', { rules_revision })}
          onAction={gameAction} onBack={collapseGame} onNewGame={() => { setLive(false); setOpen(true); }} lobbyControl={<>{menuLeaveControl}{leaveControl}</>}
          endControl={canEnd ? <EndGameControl table compact busy={busy} onEnd={() => lobbyAction('/end')} /> : null} />
        : snapshot.game_type === 'marriage' ? <MarriageTable tableControl={<>{lifecycleControl}{snapshot.rule_proposal?.status !== 'PENDING' && ruleReview}</>} onTableAction={command => void lobbyAction(`/table/${command}`)} key={snapshot.match_id} snapshot={visibleSnapshot || snapshot} busy={busy} error={error} lobbyControl={<>{menuLeaveControl}{leaveControl}</>} onSave={scoring => lobbyAction('/marriage-settings', { scoring })}
          onAction={gameAction} onStart={() => lobbyAction('/start', { play_mode: 'manual' })} onBack={collapseGame}
          onNewGame={() => { setLive(false); setOpen(true); }} endControl={canEnd ? <EndGameControl compact busy={busy} onEnd={() => lobbyAction('/end')} /> : null}
          social={{ connected, phrases: personal.phrases, save: personal.save, send: (recipient, text) => social.send(snapshot.match_id!, recipient, text) }} />
        : <LiveGameTable lobbyControl={<>{menuLeaveControl}{leaveControl}</>} tableControl={<>{lifecycleControl}{snapshot.rule_proposal?.status !== 'PENDING' && ruleReview}</>} onTableAction={command => void lobbyAction(`/table/${command}`)} endControl={canEnd ? <EndGameControl compact busy={busy} onEnd={() => lobbyAction('/end')} /> : null} onNextDeal={() => lobbyAction('/next-deal', { deal_number: snapshot.round_review?.deal_number })} key={snapshot.match_id} snapshot={visibleSnapshot || snapshot} busy={busy} error={error} onAction={gameAction} onNewGame={() => { setCapacity(snapshot.capacity === 5 ? 5 : 4); setLive(false); setOpen(true); }} onStart={() => lobbyAction('/start', { play_mode: 'manual' })} onSave={settings => lobbyAction('/settings', settings)} onBack={collapseGame}
          social={{ connected, phrases: personal.phrases, save: personal.save, send: (recipient, text) => social.send(snapshot.match_id!, recipient, text) }} />}
        <ScrollView testID="game-footer" style={[styles.gameFooter, mobileGame && { borderTopWidth: 0 }]} contentContainerStyle={{ gap: 4 }} nestedScrollEnabled>
          {snapshot.can_join && !snapshot.your_player_id && <View testID="in-game-invitation" style={[styles.invitation, { padding: 14, margin: 12, marginBottom: 0 }]}>
            <Text accessibilityRole="alert" accessibilityLiveRegion="assertive" style={styles.summary}>A new {gameName} {noun} is ready!</Text>
            <Pressable accessibilityRole="button" accessibilityLabel={`Join ${noun}`} disabled={busy} accessibilityState={{ disabled: busy }} onPress={() => void act(true)} style={styles.button}>
              <Text style={styles.buttonText}>{`Join ${noun}`}</Text>
            </Pressable>
          </View>}
          {(!connected || !synced) && <Text accessibilityRole="alert" style={styles.connectionNotice}>{connectionMessage || (!connected ? 'Reconnecting… Your seat is saved.' : 'Updating game…')}</Text>}
          {!!actionNotice && <Text accessibilityLiveRegion="polite" style={styles.connectionNotice}>{actionNotice}</Text>}
          {snapshot.status !== 'ended' && snapshot.rule_proposal?.status === 'PENDING' && ruleReview}
        </ScrollView>
        {chat}
        </TableSocialProvider></ThemeContext.Provider>
      </View></View> :
      <KeyboardFrame style={[styles.overlay, { paddingVertical: 16 }]}><View accessibilityViewIsModal style={styles.modal}>
        <FormScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <Text accessibilityRole="header" style={styles.title}>Create table</Text>
          {createContent}
          <Text style={styles.text}>{gameType === 'flush' ? '2–10 players · lock the seated roster when ready.' : 'Seats'}</Text>
          <View style={[styles.choices, { flexWrap: 'wrap' }]}>{(gameType === 'flush' ? [] : gameType === 'marriage' ? [2, 3, 4, 5] : [4, 5]).map(size => <Pressable key={size} accessibilityRole="button" accessibilityState={{ selected: capacity === size }}
            onPress={() => setCapacity(size)} style={[styles.choice, { minHeight: 48 }, size === capacity && { borderColor: colors.accent }]}><Text style={styles.text}>{size} players</Text></Pressable>)}</View>
            <Text style={styles.text}>Table name (required)</Text><FormInput accessibilityLabel="Table name" accessibilityHint="Required to create a table" aria-required value={tableName} onChangeText={setTableName} maxLength={60} placeholder={`${selectedGameName} table`} placeholderTextColor={colors.textMuted} style={[styles.choice, { color: colors.text }]} />
            <Text style={styles.text}>Invite players (optional)</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><FormInput accessibilityLabel="Find players to invite" value={inviteQuery} onChangeText={setInviteQuery} maxLength={64}
              placeholder="Name, username, or user ID" placeholderTextColor={colors.textMuted} autoCapitalize="none" autoCorrect={false}
              returnKeyType="search" onSubmitEditing={() => void searchDirectory()} style={[styles.choice, { flex: 1, minWidth: 0, color: colors.text }]} />
            <Pressable accessibilityRole="button" accessibilityLabel="Search directory" disabled={searchingPlayers || inviteQuery.trim().length < 2} onPress={() => void searchDirectory()} style={[styles.choice, (searchingPlayers || inviteQuery.trim().length < 2) && { opacity: 0.5 }]}>
              <Text style={styles.text}>{searchingPlayers ? '…' : 'Search'}</Text>
            </Pressable></View>
            {!!selectedInvitees.length && <View style={styles.choices}>{selectedInvitees.map(player => <Pressable key={player.user_id} accessibilityRole="button" accessibilityLabel={`Remove ${player.display_name || player.username || player.user_id}`} onPress={() => setSelectedInvitees(current => current.filter(item => item.user_id !== player.user_id))} style={styles.choice}>
              <Text style={styles.text}>{player.display_name || player.username || player.user_id} · Remove</Text>
            </Pressable>)}</View>}
            {!!inviteResults.length && <View>{inviteResults.filter(player => !selectedInvitees.some(selected => selected.user_id === player.user_id)).map(player => <Pressable key={player.user_id} accessibilityRole="button" disabled={player.eligible === false} accessibilityLabel={`Invite ${player.display_name || player.username || player.user_id}`} onPress={() => setSelectedInvitees(current => [...current, player])} style={[styles.choice, player.eligible === false && { opacity: 0.5 }]}>
              <Text style={styles.summary}>{player.display_name || player.username || 'Player'}</Text>
              <Text style={styles.note}>{player.username ? `@${player.username} · ` : ''}{player.user_id}{player.eligible === false ? ` · ${player.reason}` : ''}</Text>
            </Pressable>)}</View>}
            {!!inviteError && <Text accessibilityRole="alert" style={styles.error}>{inviteError}</Text>}
          <Text style={styles.note}>Review advanced rules at the table before starting. Rule changes still require player approval.</Text>
        </FormScrollView>
        <FormFooter>
          {!!error && <Text accessibilityRole="alert" style={styles.modalError}>{error}</Text>}
          {!synced && <Text accessibilityLiveRegion="polite" style={styles.note}>{sessionActive ? 'Waiting for the table service. Your form will stay open while it retries.' : 'Sign in again before creating a table.'}</Text>}
          {refreshError && sessionActive && <Pressable accessibilityRole="button" accessibilityLabel="Retry table service" onPress={() => setActionTick(value => value + 1)} style={styles.choice}><Text style={styles.text}>Retry table service</Text></Pressable>}
          <Pressable accessibilityRole="button" accessibilityLabel="Create this table" disabled={busy || !creationEnabled || !tableName.trim()} accessibilityState={{ disabled: busy || !creationEnabled || !tableName.trim() }} onPress={() => void act(false)} style={[styles.button, (busy || !creationEnabled || !tableName.trim()) && { opacity: 0.5 }]}><Text style={styles.buttonText}>Create table</Text></Pressable>
          <Pressable accessibilityRole="button" onPress={() => setOpen(false)} style={styles.choice}><Text style={styles.text}>Back to room</Text></Pressable>
        </FormFooter>
      </View></KeyboardFrame>}
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
  gameFooter: { flexGrow: 0, flexShrink: 0, maxHeight: '38%', borderTopWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  liveOverlay: { width: '100%', height: '100%', paddingBottom: 64, overflow: 'hidden', backgroundColor: colors.background },
  codePanel: { padding: 16, borderRadius: 10, backgroundColor: colors.surface, gap: 8 },
  code: { fontFamily: fonts.medium, fontSize: 22, color: colors.text, letterSpacing: 1 },
  joinHint: { fontFamily: fonts.body, fontSize: 12, lineHeight: 21, color: colors.textMuted, marginTop: 8 },
  bar: { gap: 18, paddingTop: 24, paddingBottom: 8 }, summary: { color: colors.text, fontFamily: fonts.medium, fontSize: 14, lineHeight: 23 },
  button: { ...gameControlFinish(colors), minHeight: 44, padding: 12, borderRadius: 8, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' }, buttonText: { fontFamily: fonts.medium, fontSize: 12, color: colors.onPrimary },
  error: { color: colors.danger, padding: 12, fontFamily: fonts.body, fontSize: 12 }, overlay: { flex: 1, paddingHorizontal: 20, paddingVertical: 48, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.overlay }, modal: { ...gamePanelFinish(colors), maxWidth: 480, width: '100%', maxHeight: '100%', borderRadius: 18, overflow: 'hidden', backgroundColor: colors.surface }, body: { padding: 24, gap: 16 },
  title: { ...gameHeadingFinish(colors), fontFamily: fonts.display, fontSize: 30, color: colors.text }, text: { fontFamily: fonts.body, color: colors.text, fontSize: 13, lineHeight: 22 }, choices: { flexDirection: 'row', gap: 12 }, choice: { minHeight: 44, padding: 10, borderWidth: 1, borderColor: colors.border, borderRadius: 8, alignItems: 'center', justifyContent: 'center' }, player: { fontFamily: fonts.medium, fontSize: 13, color: colors.text }, note: { fontFamily: fonts.body, color: colors.textMuted, fontSize: 11, lineHeight: 19 }, modalError: { fontFamily: fonts.body, color: colors.danger, fontSize: 12 },
});
