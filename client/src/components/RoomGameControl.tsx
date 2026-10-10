import { Ionicons } from '@expo/vector-icons';
import { GameSessionStatus } from './GameSessionStatus';
import {AppText as Text} from './AppText';
import { usePersistentNotice } from '../multiplayer/usePersistentNotice';
import { playerPresence } from '../multiplayer/playerPresence';
import { isVisibleRoomTable } from '../multiplayer/tableNavigation';
import { playerError } from '../multiplayer/playerError.ts';
import { committedSnapshot } from '../multiplayer/committedSnapshot';
import type { OriginalDistributedRuntime } from '../multiplayer/OriginalDistributedRuntime';
import type { SelectedTable } from '../multiplayer/DistributedControls';
import { DistributedGameCommandClient, GameConfirmationPending } from '../multiplayer/DistributedGameCommandClient';
import { ui, uiLabel } from '../i18n/copy.ts';
import { useUiLanguage } from '../i18n/useUiLanguage';
import { visualStates, radii, gameControlFinish, gameHeadingFinish, gamePanelFinish, fonts, ThemeContext, useTheme, useThemedStyles, type ThemeColors } from '../theme';
import { useTableTheme } from '../TableThemeProvider';
import { FormScrollView } from './FormInput';
import { KeyboardFrame } from './KeyboardFrame';
import { FormFooter } from './FormFooter';
import { TableSocialProvider, TableSocialPresentation } from './TableSocial';
import type { TableSocialChannel } from '../multiplayer/TableSocialChannel';
import {CreationCards,useCreationProgress} from './CreationCards';
import { TableCard } from './TableCard';
import type { TableEntry } from '../multiplayer/tableNavigation';
import { RuleProposal } from './RuleProposal';
import { TableControls } from './TableControls';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import {AppState, Modal, Platform, Pressable, ScrollView, StyleSheet, View, useWindowDimensions} from 'react-native';
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
import { GameModalContent, GameModalRoot } from './GameModal';
import {CreateTableForm} from './CreateTableForm';
import { useCardTheme, TableCardThemeProvider } from '../CardThemeProvider';
import { request } from '../multiplayer/api';

type InvitePlayer = { user_id: string; display_name: string; username?: string | null; eligible?: boolean; reason?: string | null };

export function RoomGameControl({ runtime, socialChannel, chat, onOpenChange, onViewChange, requestedMatchId, requestedEntry, onEntryError, roomId, apiUrl, token, connected, sessionActive = true, members, presenceKnown = true, roomMembers = members, connectionMessage, userId, pokes, personal, onGameTypeChange, creationEnabled = true, gameType = 'callbreak' }: {
  runtime?: OriginalDistributedRuntime | null;
  presenceKnown?: boolean;
  socialChannel?: TableSocialChannel; chat?: ReactNode; onOpenChange?: (open: boolean) => void; onViewChange?: (match:string|null)=>void;
  requestedMatchId?: string; requestedEntry?: TableEntry; onEntryError?:()=>void;
  gameType?: 'callbreak' | 'marriage' | 'flush';
  onGameTypeChange?: (game:'callbreak'|'marriage'|'flush')=>void; creationEnabled?: boolean;
  userId: string; pokes: RoomPoke[]; personal: ReturnType<typeof usePlayerPhrases>;
  roomId: string; apiUrl: string; token: string; connected: boolean; sessionActive?: boolean; members: string[]; roomMembers?: string[]; connectionMessage?: string;
}) {
  useUiLanguage();
  const creation=useCreationProgress(runtime);
  const creationPending=creation.cards.some(card=>card.kind==='table');
  const { colors } = useTheme();
  const { id: cardTheme } = useCardTheme();
  const { theme: gameTheme } = useTableTheme();
  const styles = useThemedStyles(createStyles);
  const mobile = useWindowDimensions().width < 900;
  const insets = useSafeAreaInsets();
  const social = useRoomPokes(roomId, userId, token, connected);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const snapshotRef=useRef(snapshot);snapshotRef.current=snapshot;
  const rescheduleRefresh=useRef<()=>void>(()=>{});
  const [open, setOpen] = useState(false);
  useEffect(()=>{
    if(!runtime||!snapshot?.table_id)return;
    void runtime.root.select({room:roomId,table:snapshot.status==='ended'?null:snapshot.table_id,
      chat:snapshot.status==='ended'||runtime.root.ephemeralEnabled?['room_chat']:['room_chat','table_chat']}).catch(()=>{});
  },[runtime,roomId,snapshot?.table_id,snapshot?.durable_game_id,snapshot?.status==='ended',runtime?.root.ephemeralEnabled]);
  const [seatConflict, setSeatConflict] = useState<GameRequestDetail | null>(null);
  const visibleTables = snapshot?.tables?.filter(isVisibleRoomTable) || [];
  useEffect(() => { onOpenChange?.(open); }, [open, onOpenChange]);
  useEffect(() => () => onOpenChange?.(false), [onOpenChange]);
  const [live, setLive] = useState(false);
  useEffect(() => {onViewChange?.(open && live ? snapshot?.match_id || null : null);return () => onViewChange?.(null);},[onViewChange,open,live,snapshot?.match_id]);
  const collapsed = !open && live && !!snapshot && snapshot.status !== 'empty';
  const notification = useGameNotification(snapshot, collapsed, false);
  function collapseGame() { notification.prepare(); setOpen(false); }
  const handledSessionExit = useRef<string | null>(null);
  useEffect(() => {
    const session = snapshot?.session;
    const reason = session?.expired_at ? 'expired' : session?.removal_reason === 'ACTION_TIMEOUT' ? 'removed' : null;
    if (!reason) return;
    const key = `${snapshot?.match_id}:${reason}`;
    if (handledSessionExit.current === key) return;
    handledSessionExit.current = key;
    setOpen(false); setLive(false);
    setError(ui(reason === 'expired' ? 'rooms.session_expired' : 'rooms.session_removed'));
  }, [snapshot?.match_id, snapshot?.session?.expired_at, snapshot?.session?.removal_reason]);
  const [capacity, setCapacity] = useState<4|5>(4);
  const [selectedInvitees, setSelectedInvitees] = useState<InvitePlayer[]>([]);
  const [pendingAction, setBusy] = useState(false);
  const [startingGame, setStartingGame] = useState(false);
  const [formationBlocked, setFormationBlocked] = useState(false);
  const base = `${apiUrl}/test-games/${encodeURIComponent(roomId)}`;
  const selectedMatch = useRef<string | undefined>(requestedMatchId);
  const transport = useMemo(() => {
    if(process.env.EXPO_PUBLIC_RUNTIME_MODE !== 'distributed-original')return createHttpGameTransport<Snapshot>(base,token,globalThis.fetch,()=>selectedMatch.current);
    const send=(suffix='',body?:object,signal?:AbortSignal)=>request<Snapshot>(`/test-games/${encodeURIComponent(roomId)}${suffix}`,{user_id:userId,token},body,signal);
    return {request:send,snapshot:(signal:AbortSignal)=>send(selectedMatch.current?`?match_id=${encodeURIComponent(selectedMatch.current)}`:'',undefined,signal),
      action:(body:object,signal:AbortSignal)=>send('/action',body,signal)};
  },[base,token,roomId,userId,runtime]);
  useEffect(() => {
    if (requestedMatchId) { selectedMatch.current = requestedMatchId; setActionTick(v => v + 1); }
  }, [requestedMatchId]);
  const commandClient = useMemo(() => runtime
    ? new DistributedGameCommandClient(runtime.root.session.command('original-game-actions'),
      (signal,invalidate=false)=>runtime.root.readGameView<Snapshot>(roomId,selectedMatch.current??null,signal,invalidate),
      snapshot=>({...snapshot,room_id:roomId}) as unknown as SelectedTable,()=>runtime.root.pushViewsEnabled)
    : new GameCommandClient(transport), [transport,runtime,roomId]);
  const [actionTick, setActionTick] = useState(0);
  const [actionNotice, setActionNotice] = useState('');
  const [synced, setSynced] = useState(false);

  // HTTP table operations use durable room membership. Chat/presence socket
  // readiness must not prevent the first snapshot or freeze table creation.
  const busy = pendingAction || !sessionActive || !synced;
  const [actionError, setError] = useState('');
  const [refreshError, setRefreshError] = useState('');
  const showRefreshError = usePersistentNotice(!!refreshError);
  const error = actionError || (showRefreshError ? refreshError : '');
  useEffect(()=>{if(requestedMatchId && (error || refreshError || snapshot?.status==='ended'))onEntryError?.();},[requestedMatchId,error,refreshError,snapshot?.status,onEntryError]);

  // The lobby omits completed tables even while their seats remain reserved.
  // Keep the server's departure prompt until departure is confirmed or cancelled;
  // absence from this list cannot establish that the previous seat was released.
  const generation = useRef(0), pending = useRef(false);
  const alive = useRef(true);
  const requests = useRef(new Set<AbortController>());
  const canSend = useRef(false);
  canSend.current = sessionActive && synced && !commandClient.pending;
  const visibleSnapshot = snapshot ? { ...snapshot, players: snapshot.players?.map(player => ({
    ...player, connected: playerPresence(player.user_id, members, presenceKnown, { user: userId, connected }),
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
      setError(''); setRefreshError(''); setActionNotice('');
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

  // Foreground create/join/navigation requests belong to the screen session,
  // not a background refresh. WebSocket invalidations may restart refreshes
  // while a durable table command is still returning its committed snapshot.
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false; generation.current++;
      requests.current.forEach(request => request.abort());
    };
  }, [commandClient, sessionActive]);

  const refreshClient = useRef(commandClient);
  useEffect(() => {
    if(!runtime || refreshClient.current!==commandClient)setSynced(false);
    refreshClient.current=commandClient;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let refreshFailed = false, refreshing = false;
    const schedule=()=>{
      if(controller.signal.aborted || refreshing)return;
      clearTimeout(timer);
      const delay=runtime ? runtime.root.snapshotClock.delay(roomId,selectedMatch.current??snapshotRef.current?.match_id,
        commandClient.pending,refreshFailed) : 1000;
      timer=setTimeout(refresh,delay);
    };
    rescheduleRefresh.current=schedule;
    async function refresh() {
      if(refreshing || controller.signal.aborted)return;
      refreshing=true;
      const version = generation.current;
      let noticeTimer: ReturnType<typeof setTimeout> | undefined;
      try {
        if (!pending.current) {
          const hadPending = commandClient.pending;
          if (hadPending) {
            const showNotice = () => {
              if (!controller.signal.aborted && generation.current === version)
                setActionNotice(ui("feedback.confirming_your_action"));
            };
            if (runtime) noticeTimer = setTimeout(showNotice, 500);
            else showNotice();
          }
          const result = await commandClient.refresh(controller.signal);
          if (controller.signal.aborted || generation.current !== version) return;
          const data = result.snapshot;
          if(runtime && data.match_id && !selectedMatch.current && data.status!=='ended')selectedMatch.current=data.match_id;
          if (hadPending) {
            setError(result.error ? playerError(result.error) : ''); setBusy(false); setActionNotice('');
          }
          if (!controller.signal.aborted && generation.current === version) {
            setSnapshot(current=>committedSnapshot(current,data)); snapshotRef.current=committedSnapshot(snapshotRef.current,data); refreshFailed=false; setRefreshError(''); setSynced(true);
          }
        }
      } catch (error) {
        if (!controller.signal.aborted && generation.current === version) {
          if (error instanceof GameConfirmationPending) {
            setRefreshError('');
            return; // Still pending, not a failed connection or rejected move.
          }
          const message = commandClient.pending ? ui("feedback.please_wait_confirmation") : playerError(error, ui("feedback.cannot_load_game"));
          refreshFailed = true; setSynced(false);
          if (commandClient.pending) setActionNotice(ui("common.connection_interrupted_your_action_will_be_checked_automatically"));
          setRefreshError(message);
        }
      }
      finally {
        clearTimeout(noticeTimer); refreshing=false;
        if (!controller.signal.aborted) schedule();
      }
    }
    if (sessionActive) refresh();
    return () => {
      controller.abort(); clearTimeout(timer); if(rescheduleRefresh.current===schedule)rescheduleRefresh.current=()=>{};
    };
  }, [commandClient, sessionActive, actionTick]);
  useEffect(() => {
    if (!runtime || !sessionActive) return;
    return runtime.root.observeSnapshot(view => {
      if (view.room_id !== roomId) return;
      if (!view.snapshot) { setActionTick(value=>value+1); return; }
      const next = view.snapshot as unknown as Snapshot;
      if (selectedMatch.current && next.match_id !== selectedMatch.current) return;
      setSnapshot(current=>committedSnapshot(current,next));
      if(commandClient instanceof DistributedGameCommandClient)commandClient.observe(next);
      setSynced(true); setRefreshError('');
      snapshotRef.current=next;rescheduleRefresh.current();
    });
  }, [runtime, roomId, sessionActive, commandClient]);

  useEffect(() => {
    if(!runtime)return;
    const wake=()=>{setActionTick(value=>value+1);void runtime.root.wake().catch(()=>{});};
    const sub=AppState.addEventListener('change',state=>{if(state==='active')wake();});
    if(Platform.OS==='web')globalThis.addEventListener('online',wake);
    return()=>{sub.remove();if(Platform.OS==='web')globalThis.removeEventListener('online',wake);};
  },[runtime]);

  async function returnToGame() {
    if (busy || pending.current) return;
    pending.current = true; const version = ++generation.current; setBusy(true); setError('');
    try {
      const data = await api(selectedMatch.current ? `?match_id=${encodeURIComponent(selectedMatch.current)}` : '');
      if (alive.current && generation.current === version) {
        setSnapshot(data); setLive(data.status !== 'empty'); setOpen(true);
      }
    } catch (error) {
      if (alive.current) setError(playerError(error, ui("feedback.could_not_restore_game")));
    } finally { pending.current = false; if (alive.current) setBusy(false); }
  }
  const [unselectedInviteQuery,setUnselectedInviteQuery]=useState(false);
  const creationVisible=useRef(open);creationVisible.current=open;
  async function act(join: boolean) {
    if (!canSend.current || pending.current || (!join && unselectedInviteQuery)) return;
    pending.current = true; const version = ++generation.current; setBusy(true); setError('');
    try {
      const data = await api(join ? '/join' : '', join ? { match_id: snapshot?.match_id } : { ...(gameType === 'callbreak' ? {player_count:capacity} : {}), notify_room:true, game_type: gameType, card_theme: cardTheme, invitees: selectedInvitees.map(player => player.user_id) });
      if (alive.current && generation.current === version) {
        selectedMatch.current = data.match_id;
        setSnapshot(data); setLive(true); if(join || creationVisible.current)setOpen(true);
        if (!join) setSelectedInvitees([]);
      }
    } catch (error) {
      if (alive.current && generation.current === version) {
        if (error instanceof GameRequestError && error.detail?.code === 'PLAYER_ALREADY_AT_TABLE') {
          setSeatConflict(error.detail); setOpen(false);
        }
        setError(playerError(error, ui("feedback.cannot_update_game")));
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
          setError(ui("common.previous_table_reserved"));
          return;
        }
        setSeatConflict(null);
        setError(ui("common.previous_table_ended"));
        return;
      }
      const command = seatConflict.departure_command === 'abandon' ? 'table/abandon' : 'leave';
      await request(`/test-games/${encodeURIComponent(seatConflict.room_id)}/${command}`,
        { user_id: userId, token }, { match_id: seatConflict.match_id });
      setSeatConflict(null);
      setError(ui("rooms.previous_table_left_you_can_now_take_a_seat_here"));
    } catch (error) {
      setError(playerError(error, ui("feedback.could_not_leave_the_previous_table")));
    } finally { pending.current = false; setBusy(false); }
  }
  const mobileGame = mobile;
  const canCreate = snapshot?.status === 'empty' || (snapshot?.status === 'finished' && !snapshot.table?.requires_replacement) || snapshot?.status === 'ended';
  const canEnd = !!snapshot?.can_end_table || ((!canCreate || snapshot?.status === 'finished') &&
    (snapshot?.is_creator || (connected && roomMembers.length === 1 && roomMembers[0] === userId)));
  const gameName = ({ marriage: 'Marriage', callbreak: 'Call Break', flush: 'Flush' })[(canCreate ? gameType : snapshot?.game_type) || 'callbreak'];
  const noun = (canCreate ? gameType : snapshot?.game_type) === 'flush' ? 'table' : 'game';
  const autoPlay = snapshot?.game_type === 'callbreak' && snapshot.session?.controls.some(c => c.user_id === userId && c.mode === 'auto');
  async function gameAction(command: string, payload: object = {}) {
    if (autoPlay) return;
    if (!canSend.current || !snapshot?.game || !snapshot.match_id || pending.current) return;
    if (!commandClient.submit(snapshot, command, payload)) return;
    canSend.current = false; generation.current++;
    setBusy(true); setError(''); setActionNotice(runtime ? '' : ui("feedback.sending_your_action"));
    setActionTick(value => value + 1);
  }
  async function lobbyAction(suffix: string, payload: object = {}) {
    if (!canSend.current || !snapshot || pending.current) return;
    pending.current = true; const version = ++generation.current; setBusy(true); setError('');
    setStartingGame(suffix === '/start' || suffix === '/table/next-match');
    try {
      let data = await api(suffix, { match_id: snapshot.match_id, ...payload });
      if (suffix === "/table/next-match" && alive.current && generation.current === version) {
        selectedMatch.current = data.match_id; snapshotRef.current = data; setSnapshot(data);
        data = await api("/start", { match_id: data.match_id, play_mode: "manual", rules_revision: data.flush_settings?.rules_revision });
      }
      if (alive.current && generation.current === version) {
        selectedMatch.current = data.match_id; setSnapshot(data);
        if (suffix === '/leave' || suffix === '/table/leave-seat' || suffix === '/table/abandon' || suffix === '/table/pause-seat') { setOpen(false); setLive(false); }
      }
    } catch (error) { if (alive.current && generation.current === version) setError(playerError(error, ui("feedback.could_not_update_game"))); }
    finally { pending.current = false; if (alive.current) { setBusy(false); setStartingGame(false); } }
  }
  const endControl = canEnd
    ? <EndGameControl table={snapshot?.game_type === 'flush' || snapshot?.status === 'finished'} key={`end-${snapshot?.match_id}`} busy={busy} onEnd={() => lobbyAction('/end')} /> : null;
  const lifecycleControl = snapshot?.table ? <TableControls starting={startingGame} menuSection="manage" table={snapshot.table} members={roomMembers} userId={userId} busy={busy} formationBlocked={formationBlocked}
    act={(command, payload) => lobbyAction(`/table/${command}`, payload)}
    start={() => lobbyAction('/start', { play_mode: 'manual', rules_revision: snapshot.flush_settings?.rules_revision })} /> : null;
  const menuLeaveControl = snapshot?.table ? <TableControls menuSection="leave" table={snapshot.table} members={roomMembers} userId={userId} busy={busy}
    act={(command, payload) => lobbyAction(`/table/${command}`, payload)} start={() => lobbyAction('/start')} /> : null;
  const leaveControl = !snapshot?.table?.current_user.can_leave_seat && !snapshot?.table?.current_user.can_abandon_match && !snapshot?.table?.current_user.can_pause_match && snapshot?.your_player_id
    ? <Pressable accessibilityRole="button" accessibilityLabel={snapshot.game_type === 'flush' || snapshot.game_type === 'marriage' ? ui("rooms.leave_table") : ui("common.leave_gameortable", { "gameOrTable": noun })} disabled={busy} accessibilityState={{ disabled: busy }} onPress={() => void lobbyAction('/leave')} style={{ minHeight: 44, padding: 10, justifyContent: 'center', flexDirection: 'row', alignItems: 'center', gap: 8 }}><Ionicons name="exit-outline" size={19} color={colors.text} /><Text style={[styles.text, { color: colors.text }]}>{snapshot.game_type === 'flush' || snapshot.game_type === 'marriage' ? ui("rooms.leave_table") : ui("common.leave_gameortable", { "gameOrTable": noun })}</Text></Pressable> : null;
  const ruleReview = snapshot?.rule_proposal && <RuleProposal key={snapshot.rule_proposal.id} proposal={snapshot.rule_proposal} busy={busy} userId={userId} error={uiLabel(error, 'feedback')} vote={accept => void lobbyAction('/rule-vote', { proposal_id: snapshot.rule_proposal!.id, accept })} />;
  async function enterTable(matchId: string, action: TableEntry) {
    if (busy || pending.current) return;
    pending.current = true; const version = ++generation.current; setBusy(true); setError('');
    try {
      const path=`?match_id=${encodeURIComponent(matchId)}`;
      let data:Snapshot;
      try{
        data = await api(action === 'seat' ? '/join' : action === 'queue' ? '/table/join-queue' : path,
          action === 'watch' ? undefined : { match_id: matchId });
      }catch(failure){
        // A seat can disappear after the feed is read. Only a definitive
        // capacity rejection may become spectator entry; uncertain commands
        // and conflicts with another occupied table retain their error flow.
        if(action!=='seat'||!(failure instanceof GameRequestError)||failure.status!==409||failure.detail?.code==='PLAYER_ALREADY_AT_TABLE')throw failure;
        const latest=await api(path);
        if(latest.match_id!==matchId||latest.can_join||latest.status==='ended')throw failure;
        data=latest;
      }
      if (!alive.current || generation.current !== version) return;
      selectedMatch.current = data.match_id;
      setSnapshot(data); setLive(true); setOpen(true);
    } catch (failure) {
      if (!alive.current || generation.current !== version) return;
      setError(playerError(failure, ui("feedback.could_not_enter_this_table")));
      if (failure instanceof GameRequestError && failure.detail?.code === 'PLAYER_ALREADY_AT_TABLE') {
        setOpen(false);
        setSeatConflict(failure.detail);
      }
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
  const content = <>
    {!snapshot && !refreshError && <Text accessibilityLiveRegion="polite" style={styles.text}>{sessionActive ? ui("rooms.loading_tables") : ui("feedback.sign_in_again_to_load_tables")}</Text>}
    {refreshError && <Pressable accessibilityRole="button" accessibilityLabel={ui("rooms.retry_loading_tables")} disabled={pendingAction || !sessionActive}
      onPress={() => setActionTick(value => value + 1)} style={styles.choice}><Text style={styles.text}>{ui("rooms.retry_loading_tables")}</Text></Pressable>}
    {!snapshot && <Pressable accessibilityRole="button" accessibilityLabel={ui("rooms.create_table")} disabled={pendingAction || !sessionActive || !creationEnabled}
      onPress={() => { setLive(false); setOpen(true); }} style={[styles.button, { backgroundColor: colors.primary, minHeight: 48 }]}>
      <Text style={[styles.buttonText, { color: colors.onPrimary }]}>{ui("rooms.create_table_2")}</Text>
    </Pressable>}
    {snapshot && !visibleTables.length && <View testID="room-empty-tables" style={{ flexGrow: 1, minHeight: 260, alignItems: 'center', justifyContent: 'center', paddingVertical: 32, gap: 24 }}>
      <Text style={[styles.text, { textAlign: 'center', maxWidth: 320, fontSize: 17, lineHeight: 26 }]}>{ui("rooms.no_tables_yet_start_a_table_and_invite_your_friends")}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={ui("rooms.create_table")} disabled={pendingAction || !sessionActive || !creationEnabled} accessibilityState={{ disabled: pendingAction || !sessionActive || !creationEnabled }} onPress={() => { setLive(false); setOpen(true); }} style={[styles.button, { backgroundColor: colors.primary, minHeight: 48, paddingHorizontal: 24, opacity: pendingAction || !sessionActive || !creationEnabled ? visualStates.disabledOpacity : 1 }]}>
        <Text style={[styles.buttonText, { color: colors.onPrimary, fontSize: 15 }]}>{ui("rooms.create_table_2")}</Text>
      </Pressable>
    </View>}
    <CreationCards runtime={runtime} kind="table" roomId={roomId} matches={visibleTables.map(table=>table.match_id)}/>
    {visibleTables.map(table => <TableCard key={table.match_id} roomId={roomId} table={table} busy={busy} enter={action => void enterTable(table.match_id, action)} />)}
      {!!visibleTables.length && <Pressable accessibilityRole="button" accessibilityLabel={ui("rooms.create_table")} disabled={pendingAction || !sessionActive || !creationEnabled} onPress={() => { setLive(false); setOpen(true); }} style={[styles.button, { backgroundColor: colors.primary, minHeight: 52, marginBottom: 16 }]}>
        <Text style={[styles.buttonText, { color: colors.onPrimary }]}>{ui("rooms.create_new_table")}</Text>
      </Pressable>}
    {!!actionNotice && !open && <Text accessibilityLiveRegion="polite" style={styles.note}>{actionNotice}</Text>}
    {!!error && !open && <Text accessibilityRole="alert" style={styles.error}>{uiLabel(error, 'feedback')}</Text>}
    {!open && snapshot?.status !== 'ended' && snapshot?.rule_proposal?.status === 'PENDING' && ruleReview}
    {!open && <PokeOverlay pokes={pokes} matchId={snapshot?.match_id} />}
    <Modal transparent visible={!!seatConflict} animationType="fade" onRequestClose={() => setSeatConflict(null)}>
      <View style={styles.overlay}><View accessibilityViewIsModal style={styles.modal}><View style={styles.body}>
        <Text accessibilityRole="header" style={styles.title}>{seatConflict?.departure_command === 'end' ? ui("rooms.previous_table_is_reserved") : seatConflict?.departure_command === 'abandon' ? ui("rooms.abandon_active_game") : ui("rooms.leave_previous_table_2")}</Text>
        <Text style={styles.text}>{ui("rooms.one_table_help")}</Text>
        <Text style={styles.text}>{actionError}</Text>
        {seatConflict?.departure_command === 'end' && <Text style={styles.text}>{ui("rooms.end_previous_help")}</Text>}
        {seatConflict?.departure_command === 'abandon' && <Text style={styles.error}>{ui("rooms.abandon_effect")}</Text>}
        <Pressable accessibilityRole="button" disabled={pendingAction} onPress={() => void leavePreviousTable()} style={[styles.button, { backgroundColor: colors.dangerSurface, borderWidth: 1, borderColor: colors.danger }]}>
          <Text style={[styles.buttonText, { color: colors.danger }]}>{seatConflict?.departure_command === 'end' ? ui("rooms.check_table_status") : seatConflict?.departure_command === 'abandon' ? ui("rooms.abandon_previous_game") : ui("rooms.leave_previous_table")}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={() => setSeatConflict(null)} style={styles.choice}><Text style={styles.text}>{ui("rooms.stay_as_observer")}</Text></Pressable>
      </View></View></View>
    </Modal>
    {/* Web registers modal focus after its animation. A late parent onShow can
        steal focus from chat opened during the transition and block typing. */}
    <GameModalRoot transparent visible={open} animationType={Platform.OS === 'web' ? 'none' : 'fade'} onRequestClose={collapseGame}>
      {live && snapshot ? <ThemeContext.Provider value={gameTheme}><TableSocialPresentation>
      <View testID="live-game-backdrop" style={[styles.liveBackdrop, {
        backgroundColor: gameTheme.colors.background, paddingTop: insets.top, paddingBottom: insets.bottom,
        paddingLeft: insets.left, paddingRight: insets.right,
      }]}><View accessibilityViewIsModal testID="live-game-overlay" style={[styles.liveOverlay, (mobileGame || snapshot.game_type === 'flush') && !chat && { paddingBottom: 0 }]}>
        {snapshot.game_type === 'flush' ? <FlushTable connectionReady={connected && synced} onLock={() => void lobbyAction('/table/lock')} tableControl={<>{lifecycleControl}{snapshot.rule_proposal?.status !== 'PENDING' && ruleReview}</>} onFormationBlocked={setFormationBlocked} key={snapshot.match_id} snapshot={{ ...(visibleSnapshot || snapshot), starting: startingGame }} busy={busy} error={uiLabel(error, 'feedback')}
          social={{ connected, phrases: personal.phrases, save: personal.save, send: text => social.send(snapshot.match_id!, null, text) }}
          onSave={payload => lobbyAction('/flush-settings', payload)} onStart={rules_revision => lobbyAction('/start', { rules_revision })}
          onAction={gameAction} onBack={collapseGame} onNewGame={() => { setLive(false); setOpen(true); }} lobbyControl={<>{menuLeaveControl}{leaveControl}</>}
          endControl={canEnd ? <EndGameControl table compact busy={busy} onEnd={() => lobbyAction('/end')} /> : null} />
        : snapshot.game_type === 'marriage' ? <MarriageTable tableControl={<>{lifecycleControl}{snapshot.rule_proposal?.status !== 'PENDING' && ruleReview}</>} onTableAction={command => void lobbyAction(`/table/${command}`)} key={snapshot.match_id} snapshot={{ ...(visibleSnapshot || snapshot), starting: startingGame }} busy={busy} error={uiLabel(error, 'feedback')} lobbyControl={<>{menuLeaveControl}{leaveControl}</>} onSave={scoring => lobbyAction('/marriage-settings', { scoring })}
          onAction={gameAction} onStart={() => lobbyAction('/start', { play_mode: 'manual' })} onBack={collapseGame}
          onNewGame={() => { setLive(false); setOpen(true); }} endControl={canEnd ? <EndGameControl table={snapshot.status === 'finished'} compact busy={busy} onEnd={() => lobbyAction('/end')} /> : null}
          social={{ connected, phrases: personal.phrases, save: personal.save, send: (recipient, text) => social.send(snapshot.match_id!, recipient, text) }} />
        : <LiveGameTable lobbyControl={<>{menuLeaveControl}{leaveControl}</>} tableControl={<>{lifecycleControl}{snapshot.rule_proposal?.status !== 'PENDING' && ruleReview}</>} onTableAction={command => void lobbyAction(`/table/${command}`)} endControl={canEnd ? <EndGameControl table={snapshot.status === 'finished'} compact busy={busy} onEnd={() => lobbyAction('/end')} /> : null} onNextDeal={() => lobbyAction('/next-deal', { deal_number: snapshot.round_review?.deal_number })} key={snapshot.match_id} snapshot={{ ...(visibleSnapshot || snapshot), starting: startingGame }} busy={busy || !!autoPlay} error={uiLabel(error, 'feedback')} onAction={gameAction} onNewGame={() => { setCapacity(snapshot.capacity === 5 ? 5 : 4); setLive(false); setOpen(true); }} onStart={() => lobbyAction('/start', { play_mode: 'manual' })} onSave={settings => lobbyAction('/settings', settings)} onBack={collapseGame}
          social={{ connected, phrases: personal.phrases, save: personal.save, send: (recipient, text) => social.send(snapshot.match_id!, recipient, text) }} />}
        <ScrollView testID="game-footer" style={[styles.gameFooter, mobileGame && { borderTopWidth: 0 }]} contentContainerStyle={{ gap: 4 }} nestedScrollEnabled>
          {snapshot.can_join && !snapshot.your_player_id && <View testID="in-game-invitation" style={[styles.invitation, { padding: 14, margin: 12, marginBottom: 0 }]}>
            <Text accessibilityRole="alert" accessibilityLiveRegion="assertive" style={styles.summary}>{ui("rooms.new_game_ready", { "game": gameName, "kind": noun })}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel={ui("common.join_tablename", { "tableName": noun })} disabled={busy} accessibilityState={{ disabled: busy }} onPress={() => void act(true)} style={styles.button}>
              <Text style={styles.buttonText}>{ui("common.join_tablename", { "tableName": noun })}</Text>
            </Pressable>
          </View>}
          {(!connected || !synced) && <Text accessibilityRole="alert" style={styles.connectionNotice}>{connectionMessage || (!connected ? ui("feedback.reconnecting_your_seat_is_saved") : ui("feedback.updating_game"))}</Text>}
          {!!actionNotice && <Text accessibilityLiveRegion="polite" style={styles.connectionNotice}>{actionNotice}</Text>}
        </ScrollView>
        {chat}
        {snapshot.status !== 'ended' && snapshot.rule_proposal?.status === 'PENDING' && ruleReview}
        <GameSessionStatus snapshot={snapshot} userId={userId} busy={busy || !connected || !synced}
          act={command => lobbyAction(`/table/${command}`)} />
      </View></View></TableSocialPresentation></ThemeContext.Provider> :
      <GameModalContent><KeyboardFrame style={[styles.overlay, { paddingVertical: 16 }]}><View accessibilityViewIsModal style={styles.modal}>
        <FormScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <Text accessibilityRole="header" style={styles.title}>{ui("rooms.create_table")}</Text>
          <CreateTableForm onUnselectedInviteQueryChange={setUnselectedInviteQuery} session={{user_id:userId,token}} game={gameType} setGame={value=>onGameTypeChange?.(value)} callbreakPlayers={capacity} setCallbreakPlayers={setCapacity} invitees={selectedInvitees} setInvitees={setSelectedInvitees} busy={busy || !creationEnabled}/>
        </FormScrollView>
        <FormFooter>
          {!!error && <Text accessibilityRole="alert" style={styles.modalError}>{uiLabel(error, 'feedback')}</Text>}
          {!synced && <Text accessibilityLiveRegion="polite" style={styles.note}>{sessionActive ? ui("common.waiting_for_the_table_service_your_form_will_stay_open_while_it_retries") : ui("feedback.sign_in_again_before_creating_a_table")}</Text>}
          {refreshError && sessionActive && <Pressable accessibilityRole="button" accessibilityLabel={ui("rooms.retry_table_service")} onPress={() => setActionTick(value => value + 1)} style={styles.choice}><Text style={styles.text}>{ui("rooms.retry_table_service")}</Text></Pressable>}
          <Pressable accessibilityRole="button" accessibilityLabel={ui("rooms.create_this_table")} disabled={busy || creationPending || unselectedInviteQuery || !creationEnabled} accessibilityState={{ disabled: busy || creationPending || unselectedInviteQuery || !creationEnabled }} onPress={() => void act(false)} style={[styles.button, {minHeight:52,borderWidth:1,borderColor:colors.onPrimary}, (busy || !creationEnabled) && { opacity: visualStates.disabledOpacity }]}><Text style={styles.buttonText}>{ui("rooms.create_table")}</Text></Pressable>
          <Pressable accessibilityRole="button" onPress={() => setOpen(false)} style={styles.choice}><Text style={styles.text}>{ui("common.back_to_room")}</Text></Pressable>
        </FormFooter>
      </View></KeyboardFrame></GameModalContent>}
    </GameModalRoot>
  </>;
  return live && snapshot ? <TableCardThemeProvider id={snapshot.card_theme} canChange={snapshot.can_change_card_theme === true} pending={busy || !connected || !synced} select={theme => void lobbyAction('/card-theme', {card_theme:theme})}><TableSocialProvider key={snapshot.match_id} snapshot={{ ...(visibleSnapshot || snapshot), starting: startingGame }} channel={socialChannel} connected={connected} userId={userId} session={{user_id:userId,token}} pokes={pokes} phrases={personal.phrases} expanded={open} colors={gameTheme.colors}>{content}</TableSocialProvider></TableCardThemeProvider> : content;
}
const createStyles = (colors: ThemeColors) => StyleSheet.create({
  invitation: { backgroundColor: colors.surfaceSelected, borderWidth: 1, borderColor: colors.accent, borderRadius: 16, padding: 20, gap: 12, marginBottom: 20 },
  roomCard: { backgroundColor: colors.surface, borderRadius: 16, padding: 24, gap: 8, marginBottom: 20 },
  sectionToggle: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  connectionNotice: { padding: 10, color: colors.accent, backgroundColor: colors.surfaceSelected, fontFamily: fonts.medium, fontSize: 12 },
  returnPanel: { gap: 10, padding: 14, marginTop: 16, borderWidth: 1, borderColor: colors.accent, borderRadius: radii.medium },
  notified: { borderWidth: 2, borderColor: colors.turnText, backgroundColor: colors.turnSurface },
  bidNotice: { padding: 14, gap: 10, borderRadius: radii.medium, borderWidth: 1, borderColor: colors.accent, backgroundColor: colors.surfaceSelected },
  liveBackdrop: { flex: 1, backgroundColor: colors.overlay, alignItems: 'center', justifyContent: 'center' },
  gameFooter: { flexGrow: 0, flexShrink: 0, maxHeight: '38%', borderTopWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  liveOverlay: { width: '100%', height: '100%', paddingBottom: 0, overflow: 'hidden', backgroundColor: colors.background },
  codePanel: { padding: 16, borderRadius: radii.medium, backgroundColor: colors.surface, gap: 8 },
  code: { fontFamily: fonts.medium, fontSize: 22, color: colors.text, letterSpacing: 1 },
  joinHint: { fontFamily: fonts.body, fontSize: 12, lineHeight: 21, color: colors.textMuted, marginTop: 8 },
  bar: { gap: 18, paddingTop: 24, paddingBottom: 8 }, summary: { color: colors.text, fontFamily: fonts.medium, fontSize: 14, lineHeight: 23 },
  button: { ...gameControlFinish(colors), minHeight: 44, padding: 12, borderRadius: radii.medium, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' }, buttonText: { fontFamily: fonts.medium, fontSize: 12, color: colors.onPrimary },
  error: { color: colors.danger, padding: 12, fontFamily: fonts.body, fontSize: 12 }, overlay: { flex: 1, paddingHorizontal: 20, paddingVertical: 48, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.overlay }, modal: { ...gamePanelFinish(colors), maxWidth: 480, width: '100%', maxHeight: '100%', borderRadius: radii.large, overflow: 'hidden', backgroundColor: colors.surface }, body: { padding: 24, gap: 16 },
  title: { ...gameHeadingFinish(colors), fontFamily: fonts.display, fontSize: 30, color: colors.text }, text: { fontFamily: fonts.body, color: colors.text, fontSize: 13, lineHeight: 22 }, choices: { flexDirection: 'row', gap: 12 }, choice: { minHeight: 44, padding: 10, borderWidth: 1, borderColor: colors.border, borderRadius: radii.medium, alignItems: 'center', justifyContent: 'center' }, player: { fontFamily: fonts.medium, fontSize: 13, color: colors.text }, note: { fontFamily: fonts.body, color: colors.textMuted, fontSize: 11, lineHeight: 19 }, modalError: { fontFamily: fonts.body, color: colors.danger, fontSize: 12 },
});
