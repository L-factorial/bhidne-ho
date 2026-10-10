import {SIGNUP_RULES_VERSION} from '../auth/communityRules';
import { setSessionNotice } from '../auth/sessionNotice';
import { usePersistentNotice } from './usePersistentNotice';
import { playerError } from './playerError.ts';
import { OriginalDistributedRuntime, originalDistributedOwner } from './OriginalDistributedRuntime';
import { acquireJournal } from './journalPlatform';
import { DistributedRequestError } from './DistributedHttpTransport';
import { RoomActionRejected } from './DistributedRoomActions';
import { ui } from '../i18n/copy.ts';
import { validSignupEmail } from '../auth/email';
import { legacyRoomActions } from './legacyRoomActions';
import type { RoomActions } from './RoomActions';
import { TableSocialChannel } from './TableSocialChannel';
import { useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { apiUrl, ApiError, request, sharedRequest } from './api';
import { readSession, saveSession, signOutSession, isCurrentSession, type Room, type Session } from './session';
import { RoomConnection, type ConnectionStatus } from './RoomConnection';
import { appendPoke, readPoke, type RoomPoke } from './pokes';

type Membership = { room_id: string; tables: { status: string }[]; active_game: { game_id: string; game_type: 'callbreak' | 'marriage' | 'flush'; status: string; player_is_participant: boolean } | null };

export function useRoomSession(suppliedRoomActions: RoomActions = legacyRoomActions) {
  const distributed = process.env.EXPO_PUBLIC_RUNTIME_MODE === 'distributed-original';
  const [owner] = useState(() => originalDistributedOwner(acquireJournal));
  const [startupError, setStartupError] = useState('');
  const [startupAttempt, setStartupAttempt] = useState(0);
  const [runtime, setRuntime] = useState<OriginalDistributedRuntime | null>(null);
  const roomActions = runtime?.roomActions ?? suppliedRoomActions;
  const [socialChannel] = useState(() => new TableSocialChannel());
  const [pokes, setPokes] = useState<RoomPoke[]>([]);
  const [saved] = useState(() => readSession(apiUrl));
  const [session, setSession] = useState<Session | null>(saved?.session || null);
  const [room, setRoom] = useState<Room | null>(saved?.room || null);
  const currentRoom = useRef(room);
  currentRoom.current = room;
  const [game, setGame] = useState<string | null>(saved?.game || null);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const [error, setError] = useState('');
  const [deliveryInterrupted, setDeliveryInterrupted] = useState(false);
  const [refreshInterrupted, setRefreshInterrupted] = useState(false);
  const [recoveryKind, setRecoveryKind] = useState<'snapshot' | 'chat' | 'social' | null>(null);
  const recoveryNotice = usePersistentNotice(recoveryKind !== null);
  const connectionNotice = usePersistentNotice(deliveryInterrupted || refreshInterrupted);
  const [expired, setExpired] = useState(false);
  const [abandonRequired, setAbandonRequired] = useState(false);
  const [leaveGameRequired, setLeaveGameRequired] = useState<string | null>(null);
  const connection = useRef<RoomConnection | null>(null);

  function clearAccount() {
    connection.current?.stop(); owner.close(); setRuntime(null);
    socialChannel.send = () => false; socialChannel.transport = undefined;
    setSession(null); setRoom(null); setGame(null); setRooms([]); setMemberships([]);
    setPokes([]); setLeaveGameRequired(null); setAbandonRequired(false);
    setDeliveryInterrupted(false); setRefreshInterrupted(false); setRecoveryKind(null); setStatus('disconnected');
  }
  function expireAccount(active: Session) {
    if (!isCurrentSession(apiUrl, active)) return;
    saveSession(apiUrl, null); clearAccount();
    setSessionNotice(apiUrl, 'auth', 'session_ended');
  }

  useEffect(() => {
    setStartupError('');
    if (!distributed || !session || expired) { owner.close(); setRuntime(null); return; }
    let live=true, timer: ReturnType<typeof setTimeout>;
    const active=session;
    void owner.select(active.user_id,journal=>new OriginalDistributedRuntime(journal,apiUrl+'/distributed',active,{
      install: ()=>{},
      health: ready=>{if(live){setStatus(ready?'connected':'reconnecting');setDeliveryInterrupted(!ready);}},
      remove: ()=>{},
      recovery: kind=>{if(live)setRecoveryKind(kind);},
      transient: event=>{if(live){socialChannel.receive(event);const current=readSession(apiUrl)?.room;
        if(current){const poke=readPoke(event,current.room_id,active.user_id);if(poke)setPokes(old=>appendPoke(old,poke));}}},
      error: (_lane,error,source)=>{
        if(!live || !isCurrentSession(apiUrl, active))return;
        if(error instanceof DistributedRequestError&&error.status===401){expireAccount(active);return;}
        // A command HTTP error does not mean the delivery socket lost the seat.
        if(source==='connection') { setStatus('reconnecting'); setDeliveryInterrupted(true); }
        if (source === 'command' || error instanceof DistributedRequestError && error.status === 401) setError(playerError(error));
      },
    })).then(value=>{
      if(!live||!value)return;
      value.connectRequests(sharedRequest);value.api!.attachSocial(socialChannel);
      value.api!.recover(message=>{if(live)setError(playerError(message));});setRuntime(value);
      void value.root.reconnect().catch(error=>{
        if (!live) return;
        if (error instanceof DistributedRequestError && error.status === 401) expireAccount(active);
        else setDeliveryInterrupted(true);
      });
      async function recover(){
        if(!live || !isCurrentSession(apiUrl, active))return;
        try {
          const result=await value!.recoverRoomAction();
          if(!live || !isCurrentSession(apiUrl, active))return;
          if(result){
            const commandId=value!.roomCommandId!;
            if(result.command==='create-room'||result.command==='enter-room'){
              const controller=new AbortController();
              const target=result.room??await value!.root.reads.preview<Room>(result.roomId,controller.signal);
              if(!live || !isCurrentSession(apiUrl, active))return;
              saveSession(apiUrl,{session:active,room:target,game:null});setRoom(target);setGame(null);
            } else {
              // A recovered departure only clears the matching persisted room.
              const saved=readSession(apiUrl);
              if(saved?.room?.room_id===result.roomId){saveSession(apiUrl,{session:active,room:null,game:null});setRoom(null);setGame(null);}
            }
            value!.acknowledgeRoomAction(commandId);
          }
        }catch(error){
          if(!live || !isCurrentSession(apiUrl, active))return;
          setError(playerError(error, 'Could not recover room action.'));
          if(error instanceof RoomActionRejected&&value!.roomCommandId)value!.acknowledgeRoomAction(value!.roomCommandId);
          else timer=setTimeout(()=>void recover(),1500);
        }
      }
      void recover();
    }).catch(error=>{if(live) {
      const message = playerError(error, ui('feedback.session_start_failed'));
      setStartupError(message); setError(message);
    }});
    return()=>{live=false;clearTimeout(timer);owner.close();setRuntime(null);};
  },[session?.user_id,session?.token,expired,distributed,owner,startupAttempt]);

  const [loggingIn, setLoggingIn] = useState(false);
  const loginPending = useRef(false);
  const loginLifetime = useRef(new AbortController());
  useEffect(() => {
    const controller = new AbortController(); loginLifetime.current = controller;
    return () => controller.abort();
  }, []);
  function acceptSocialSession(value: Session) {
    if (session) return;
    saveSession(apiUrl, {session:value,room:null,game:null}); setSessionNotice(apiUrl, 'auth');
    setSession(value); setExpired(false); setError(''); setDeliveryInterrupted(false); setRefreshInterrupted(false);
  }
  function socialLoginBusy(value: boolean) { loginPending.current = value; setLoggingIn(value); }
  async function loginAccount(username: string, password: string, signup: boolean, email = '', rulesAccepted = false) {
    if (loginPending.current || session) return false;
    if (signup && !rulesAccepted) { setError(ui('feedback.community_rules_required')); return false; }
    if (signup && !validSignupEmail(email)) { setError(ui('common.enter_valid_email')); return false; }
    const lifetime = loginLifetime.current;
    loginPending.current = true; setLoggingIn(true); setError('');
    try {
      const value = await request<Session>(signup ? '/auth/signup' : '/auth/signin', null, {
        username: username.trim(), password, ...(signup ? { email: email.trim(), community_rules_version: SIGNUP_RULES_VERSION } : {}),
      }, lifetime.signal);
      if (lifetime.signal.aborted) return false;
      saveSession(apiUrl, {session:value,room:null,game:null}); setSessionNotice(apiUrl, 'auth');
      setSession(value); setExpired(false);
      return true;
    } catch (error) {
      if (lifetime.signal.aborted) return false;
      setError(error instanceof ApiError && error.status === 401 ? ui("feedback.credentials_incorrect") : playerError(error, `Could not ${signup ? ui("common.create_your_account") : ui("common.sign_in")}. Please try again.`));
      return false;
    } finally { loginPending.current = false; setLoggingIn(false); }
  }

  useEffect(() => {
    if(!runtime)return;
    const wake=()=>{void runtime.root.wake().catch(()=>{});};
    const foreground=AppState.addEventListener('change',state=>{if(state==='active')wake();});
    if(Platform.OS==='web')globalThis.addEventListener('online',wake);
    return()=>{foreground.remove();if(Platform.OS==='web')globalThis.removeEventListener('online',wake);};
  },[runtime]);

  useEffect(() => {
    if (session && !expired && isCurrentSession(apiUrl, session)) saveSession(apiUrl, { session, room, game });
  }, [session, room, game, expired]);

  useEffect(() => {
    if (!session || expired || (distributed && !runtime)) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let running=false, dirty=false, failures=0;
    const wake = () => {
      if(controller.signal.aborted)return;
      clearTimeout(timer);
      if(running){dirty=true;return;}
      timer=setTimeout(()=>void refresh(),50);
    };
    const unsubscribe=runtime?.root.observeActivity(wake);
    const foreground=AppState.addEventListener('change',state=>{if(state==='active')wake();});
    if(Platform.OS==='web')globalThis.addEventListener('online',wake);
    async function refresh() {
      if(running||controller.signal.aborted)return;
      running=true;
      try {
        const result = await request<Room[]>('/rooms', session, undefined, controller.signal);
        try {
          const checkedRoom = currentRoom.current;
          const values = await request<Membership[]>('/memberships', session, undefined, controller.signal);
          if (!controller.signal.aborted && isCurrentSession(apiUrl, session)) {
            setMemberships(values);
            // Only a successful authoritative read can revoke navigation. A room
            // entered while this read was in flight belongs to a newer selection.
            if (distributed && checkedRoom && currentRoom.current === checkedRoom
                && !values.some(value => value.room_id === checkedRoom.room_id)) {
              saveSession(apiUrl, {session: session!, room: null, game: null});
              setRoom(null); setGame(null); setLeaveGameRequired(null);
            }
          }
        } catch { /* Room navigation remains available if activity cannot be loaded. */ }
        if (!controller.signal.aborted && isCurrentSession(apiUrl, session)) { setRooms(result); setRefreshInterrupted(false); failures=0; }
      } catch (error) {
        if (!controller.signal.aborted && isCurrentSession(apiUrl, session)) {
          if ((error instanceof ApiError || error instanceof DistributedRequestError) && error.status === 401) {
            expireAccount(session!); return;
          }
          failures++; setRefreshInterrupted(true);
        }
      } finally {
        running=false;
        if (!controller.signal.aborted && isCurrentSession(apiUrl, session)) timer = setTimeout(refresh, dirty ? 50 : failures ? Math.min(1000 * 2 ** Math.min(failures - 1, 3), 5000) : runtime ? 30000 : 2000);
        dirty=false;
      }
    }
    refresh();
    return () => {
      controller.abort();clearTimeout(timer);unsubscribe?.();foreground.remove();
      if(Platform.OS==='web')globalThis.removeEventListener('online',wake);
    };
  }, [session, expired, runtime]);

  useEffect(() => {
    if (!session || expired) { setStatus('disconnected'); return; }
    if (!room) { if(!distributed)setStatus('disconnected'); return; }
    setPokes([]);
    if (distributed) {
      if(!runtime)return;
      if(runtime.api)runtime.api.selectedRoom=room.room_id;
      void runtime.root.select({room:room.room_id,table:null,chat:['room_chat']}).catch(error=>setError(playerError(error)));
      return()=>{if(runtime.api)runtime.api.selectedRoom=null;void runtime.root.select(null).catch(()=>{});};
    }
    const transport = new RoomConnection(
      `${apiUrl.replace(/^http/, 'ws')}/ws/rooms/${encodeURIComponent(room.room_id)}?token=${encodeURIComponent(session.token)}&heartbeat=1&resume=1`,
      setStatus, undefined, message => {
      if ((message as { type?: string })?.type === 'ROOM_LEFT') {
          setRoom(null); setGame(null); setLeaveGameRequired(null); return;
        }
        if ((message as { type?: string })?.type === 'ROOM_DELETED') {
          setRoom(null); setGame(null); setLeaveGameRequired(null); setError(ui("rooms.this_room_was_deleted_by_its_owner")); return;
        }
        socialChannel.receive(message);
        const poke = readPoke(message, room.room_id, session.user_id);
        if (poke) setPokes(current => appendPoke(current, poke));
      },
    );
    connection.current = transport; socialChannel.send = message => transport.send(message); transport.start();
    const wake = () => transport.retryNow();
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') wake(); });
    if (Platform.OS === 'web') globalThis.addEventListener('online', wake);
    return () => {
      transport.stop(); socialChannel.send = () => false; connection.current = null; subscription.remove();
      if (Platform.OS === 'web') globalThis.removeEventListener('online', wake);
    };
  }, [session, room?.room_id, expired, runtime]);

  async function joinRoom(target: Room, selectedGame: string | null = null) {
    if (!session || expired || !isCurrentSession(apiUrl, session) || (distributed && !runtime)) return false;
    try {
      await roomActions.enter(session, target.room_id);
      if (!isCurrentSession(apiUrl, session)) return false;
      saveSession(apiUrl,{session,room:target,game:selectedGame});
      if(runtime?.roomCommandId)runtime.acknowledgeRoomAction(runtime.roomCommandId);
      if(!distributed)setStatus('connecting'); setRoom(target); setGame(selectedGame); setLeaveGameRequired(null); setError('');
      return true;
    } catch (error) {
      setError(playerError(error, ui("feedback.could_not_enter_the_room")));
      return false;
    }
  }
  function enterRoom(target: Room, selectedGame: string | null = null) {
    if (!session || expired || !isCurrentSession(apiUrl, session) || (distributed && !runtime)) return false;
    saveSession(apiUrl,{session,room:target,game:selectedGame});
    if(runtime?.roomCommandId)runtime.acknowledgeRoomAction(runtime.roomCommandId);
    if(!distributed)setStatus('connecting'); setRoom(target); setGame(selectedGame); setLeaveGameRequired(null); setError('');
    return true;
  }
  function exitRoom() {
    if (!isCurrentSession(apiUrl, session)) return false;
    connection.current?.stop(); if(!distributed)setStatus('disconnected'); setRoom(null); setGame(null); setLeaveGameRequired(null); setError('');
    if (session && !expired && isCurrentSession(apiUrl, session)) saveSession(apiUrl, { session, room: null, game: null });
  }
  async function leaveRoom() {
    if (room && session && !expired) {
      try {
        await roomActions.leave(session, room.room_id);
      } catch (error) {
        if (!isCurrentSession(apiUrl, session)) return false;
        if (error instanceof ApiError && error.detail?.requires_leave_game) {
          setLeaveGameRequired(error.detail.match_id || null);
          setAbandonRequired(error.detail.departure_command === 'abandon');
        }
        setError(playerError(error, ui("feedback.could_not_leave_the_room")));
        return false;
      }
    }
    if (!isCurrentSession(apiUrl, session)) return false;
    connection.current?.stop(); if(!distributed)setStatus('disconnected'); setRoom(null); setGame(null); setLeaveGameRequired(null); setError('');
    if (session && !expired && isCurrentSession(apiUrl, session)) saveSession(apiUrl, { session, room: null, game: null });
    if(runtime?.roomCommandId)runtime.acknowledgeRoomAction(runtime.roomCommandId);
    return true;
  }
  async function deleteRoom() {
    if (!room || !session || expired) return false;
    try {
      await roomActions.remove(session, room.room_id);
      if (!isCurrentSession(apiUrl, session)) return false;
      connection.current?.stop(); if(!distributed)setStatus('disconnected'); setRoom(null); setGame(null); setError('');
      saveSession(apiUrl, { session, room: null, game: null });
      if(runtime?.roomCommandId)runtime.acknowledgeRoomAction(runtime.roomCommandId);
      return true;
    } catch (error) {
      setError(playerError(error, ui("feedback.could_not_delete_the_room")));
      return false;
    }
  }
  async function leaveGameAndRoom() {
    if (!room || !session || !leaveGameRequired) return false;
    try {
      await request(`/test-games/${encodeURIComponent(room.room_id)}/${abandonRequired ? 'table/abandon' : 'leave'}`, session, { match_id: leaveGameRequired });
      return await leaveRoom();
    } catch (error) {
      setError(playerError(error, ui("feedback.could_not_leave_the_game")));
      return false;
    }
  }
  async function signOut() {
    const active = session;
    const pending = signOutSession(apiUrl, active, value => sharedRequest('/auth/signout', value, {}));
    clearAccount(); setError('');
    await pending;
  }
  return { runtime, startupError, roomActions, socialChannel, loginAccount, acceptSocialSession, socialLoginBusy, loggingIn, session, room, rooms, memberships, game, setGame, joinRoom, enterRoom, exitRoom, leaveRoom, deleteRoom, signOut, leaveGameRequired, leaveGameAndRoom, abandonRequired,
    cancelLeave: () => { setLeaveGameRequired(null); setError(''); }, status, expired, error, connectionNotice, recoveryKind: recoveryNotice ? recoveryKind : null, pokes, presenceFresh: !refreshInterrupted,
    retry: () => {
      setError(''); setStartupError('');
      if (runtime) void runtime.root.wake().catch(error => setError(playerError(error)));
      else if (distributed) setStartupAttempt(attempt => attempt + 1);
      else connection.current?.retryNow();
    } };
}
