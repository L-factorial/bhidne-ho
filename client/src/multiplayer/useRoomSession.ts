import { OriginalDistributedRuntime, originalDistributedOwner } from './OriginalDistributedRuntime';
import { acquireJournal } from './journalPlatform';
import { DistributedRequestError } from './DistributedHttpTransport';
import { RoomActionRejected } from './DistributedRoomActions';
import { ui } from '../i18n/copy.ts';
import { legacyRoomActions } from './legacyRoomActions';
import type { RoomActions } from './RoomActions';
import { TableSocialChannel } from './TableSocialChannel';
import { useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { apiUrl, ApiError, request, sharedRequest } from './api';
import { readSession, saveSession, type Room, type Session } from './session';
import { RoomConnection, type ConnectionStatus } from './RoomConnection';
import { appendPoke, readPoke, type RoomPoke } from './pokes';

type Membership = { room_id: string; tables: { status: string }[]; active_game: { game_id: string; game_type: 'callbreak' | 'marriage' | 'flush'; status: string; player_is_participant: boolean } | null };

export function useRoomSession(suppliedRoomActions: RoomActions = legacyRoomActions) {
  const distributed = process.env.EXPO_PUBLIC_RUNTIME_MODE === 'distributed-original';
  const [owner] = useState(() => originalDistributedOwner(acquireJournal));
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
  const [expired, setExpired] = useState(false);
  const [abandonRequired, setAbandonRequired] = useState(false);
  const [leaveGameRequired, setLeaveGameRequired] = useState<string | null>(null);
  const connection = useRef<RoomConnection | null>(null);

  useEffect(() => {
    if (!distributed || !session || expired) { owner.close(); setRuntime(null); return; }
    let live=true, timer: ReturnType<typeof setTimeout>;
    const active=session;
    void owner.select(active.user_id,journal=>new OriginalDistributedRuntime(journal,apiUrl+'/distributed',active,{
      install: (_lane,view)=>{if(live&&view.kind==='snapshot')setStatus('connected');},
      remove: ()=>{},
      transient: event=>{if(live){socialChannel.receive(event);const current=readSession(apiUrl)?.room;
        if(current){const poke=readPoke(event,current.room_id,active.user_id);if(poke)setPokes(old=>appendPoke(old,poke));}}},
      error: (_lane,error)=>{
        if(!live)return;
        if(error instanceof DistributedRequestError&&error.status===401){saveSession(apiUrl,null);setExpired(true);}
        setStatus('reconnecting');setError(error instanceof Error?error.message:'Connection interrupted.');
      },
    })).then(value=>{
      if(!live||!value)return;
      value.connectRequests(sharedRequest);value.api!.attachSocial(socialChannel);
      value.api!.recover(message=>{if(live)setError(message);});setRuntime(value);
      void value.root.reconnect().catch(error=>{if(live)setError(String(error));});
      async function recover(){
        if(!live)return;
        try {
          const result=await value!.recoverRoomAction();
          if(!live)return;
          if(result){
            const commandId=value!.roomCommandId!;
            if(result.command==='create-room'||result.command==='enter-room'){
              const controller=new AbortController();
              const target=result.room??await value!.root.reads.preview<Room>(result.roomId,controller.signal);
              if(!live)return;
              saveSession(apiUrl,{session:active,room:target,game:null});setRoom(target);setGame(null);
            } else {
              // A recovered departure only clears the matching persisted room.
              const saved=readSession(apiUrl);
              if(saved?.room?.room_id===result.roomId){saveSession(apiUrl,{session:active,room:null,game:null});setRoom(null);setGame(null);}
            }
            value!.acknowledgeRoomAction(commandId);
          }
        }catch(error){
          if(!live)return;
          setError(error instanceof Error?error.message:'Could not recover room action.');
          if(error instanceof RoomActionRejected&&value!.roomCommandId)value!.acknowledgeRoomAction(value!.roomCommandId);
          else timer=setTimeout(()=>void recover(),1500);
        }
      }
      void recover();
    }).catch(error=>{if(live)setError(error instanceof Error?error.message:'Could not open distributed session.');});
    return()=>{live=false;clearTimeout(timer);owner.close();setRuntime(null);};
  },[session?.user_id,session?.token,expired,distributed,owner]);

  const [loggingIn, setLoggingIn] = useState(false);
  const loginPending = useRef(false);
  function acceptSocialSession(value: Session) {
    if (session) return;
    setSession(value); setExpired(false); setError('');
  }
  function socialLoginBusy(value: boolean) { loginPending.current = value; setLoggingIn(value); }
  async function loginAccount(username: string, password: string, signup: boolean, displayName = '') {
    if (loginPending.current || session) return false;
    if (signup && (!displayName.trim() || Array.from(displayName.trim()).length > 25)) { setError('Enter a profile name (1–25 characters).'); return false; }
    loginPending.current = true; setLoggingIn(true); setError('');
    try {
      const value = await request<Session>(signup ? '/auth/signup' : '/auth/signin', null, {
        username: username.trim(), password, ...(signup ? { display_name: displayName.trim() } : {}),
      });
      setSession(value); setExpired(false);
      return true;
    } catch (error) {
      setError(error instanceof Error ? error.message : `Could not ${signup ? ui("common.create_your_account") : ui("common.sign_in")}. Please try again.`);
      return false;
    } finally { loginPending.current = false; setLoggingIn(false); }
  }

  useEffect(() => {
    if (session && !expired) saveSession(apiUrl, { session, room, game });
  }, [session, room, game, expired]);

  useEffect(() => {
    if (!session || expired || (distributed && !runtime)) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const result = await request<Room[]>('/rooms', session, undefined, controller.signal);
        try {
          const checkedRoom = currentRoom.current;
          const values = await request<Membership[]>('/memberships', session, undefined, controller.signal);
          if (!controller.signal.aborted) {
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
        if (!controller.signal.aborted) { setRooms(result); setError(''); }
      } catch (error) {
        if (!controller.signal.aborted) {
          if ((error instanceof ApiError || error instanceof DistributedRequestError) && error.status === 401) {
            saveSession(apiUrl, null); setExpired(true); setError(error.message); return;
          }
          setError(ui("feedback.connection_interrupted_retrying"));
        }
      } finally { if (!controller.signal.aborted) timer = setTimeout(refresh, 2000); }
    }
    refresh();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [session, expired, runtime]);

  useEffect(() => {
    if (!session || !room || expired) { setStatus('disconnected'); return; }
    setPokes([]);
    if (distributed) {
      if(!runtime)return;
      setStatus('connecting');
      if(runtime.api)runtime.api.selectedRoom=room.room_id;
      void runtime.root.select({room:room.room_id,table:null,chat:['room_chat']}).catch(error=>setError(String(error)));
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
    if (!session || expired || (distributed && !runtime)) return false;
    try {
      await roomActions.enter(session, target.room_id);
      saveSession(apiUrl,{session,room:target,game:selectedGame});
      if(runtime?.roomCommandId)runtime.acknowledgeRoomAction(runtime.roomCommandId);
      setStatus('connecting'); setRoom(target); setGame(selectedGame); setLeaveGameRequired(null); setError('');
      return true;
    } catch (error) {
      setError(error instanceof Error ? error.message : ui("feedback.could_not_enter_the_room"));
      return false;
    }
  }
  function enterRoom(target: Room, selectedGame: string | null = null) {
    if (!session || expired || (distributed && !runtime)) return false;
    saveSession(apiUrl,{session,room:target,game:selectedGame});
    if(runtime?.roomCommandId)runtime.acknowledgeRoomAction(runtime.roomCommandId);
    setStatus('connecting'); setRoom(target); setGame(selectedGame); setLeaveGameRequired(null); setError('');
    return true;
  }
  function exitRoom() {
    connection.current?.stop(); setStatus('disconnected'); setRoom(null); setGame(null); setLeaveGameRequired(null); setError('');
    if (session && !expired) saveSession(apiUrl, { session, room: null, game: null });
  }
  async function leaveRoom() {
    if (room && session && !expired) {
      try {
        await roomActions.leave(session, room.room_id);
      } catch (error) {
        if (error instanceof ApiError && error.detail?.requires_leave_game) {
          setLeaveGameRequired(error.detail.match_id || null);
          setAbandonRequired(error.detail.departure_command === 'abandon');
        }
        setError(error instanceof Error ? error.message : ui("feedback.could_not_leave_the_room"));
        return false;
      }
    }
    connection.current?.stop(); setStatus('disconnected'); setRoom(null); setGame(null); setLeaveGameRequired(null); setError('');
    if (session && !expired) saveSession(apiUrl, { session, room: null, game: null });
    if(runtime?.roomCommandId)runtime.acknowledgeRoomAction(runtime.roomCommandId);
    return true;
  }
  async function deleteRoom() {
    if (!room || !session || expired) return false;
    try {
      await roomActions.remove(session, room.room_id);
      connection.current?.stop(); setStatus('disconnected'); setRoom(null); setGame(null); setError('');
      saveSession(apiUrl, { session, room: null, game: null });
      if(runtime?.roomCommandId)runtime.acknowledgeRoomAction(runtime.roomCommandId);
      return true;
    } catch (error) {
      setError(error instanceof Error ? error.message : ui("feedback.could_not_delete_the_room"));
      return false;
    }
  }
  async function leaveGameAndRoom() {
    if (!room || !session || !leaveGameRequired) return false;
    try {
      await request(`/test-games/${encodeURIComponent(room.room_id)}/${abandonRequired ? 'table/abandon' : 'leave'}`, session, { match_id: leaveGameRequired });
      return await leaveRoom();
    } catch (error) {
      setError(error instanceof Error ? error.message : ui("feedback.could_not_leave_the_game"));
      return false;
    }
  }
  async function signOut() {
    connection.current?.stop(); owner.close(); setRuntime(null);
    const active = session;
    saveSession(apiUrl, null); setSession(null); setRoom(null); setGame(null);
    if (active) {
      try { await request('/auth/signout', active, {}); } catch { /* Local sign-out still succeeds offline. */ }
    }
  }
  return { runtime, roomActions, socialChannel, loginAccount, acceptSocialSession, socialLoginBusy, loggingIn, session, room, rooms, memberships, game, setGame, joinRoom, enterRoom, exitRoom, leaveRoom, deleteRoom, signOut, leaveGameRequired, leaveGameAndRoom, abandonRequired,
    cancelLeave: () => { setLeaveGameRequired(null); setError(''); }, status, expired, error, pokes,
    retry: () => { if(runtime)void runtime.root.reconnect();else connection.current?.retryNow(); } };
}
