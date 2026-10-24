import {AppText as Text} from './AppText';
import {useRef,useState} from 'react';
import {Ionicons} from '@expo/vector-icons';
import {Pressable, ScrollView, View} from 'react-native';
import {RoomSheet} from './RoomSheet';
import {FormInput} from './FormInput';
import {useCardTheme} from '../CardThemeProvider';
import {CreateTableForm} from './CreateTableForm';
import { visualStates, radii, fonts,useTheme} from '../theme';
import {ui} from '../i18n/copy';
import {request,apiUrl} from '../multiplayer/api';
import {isCurrentSession,type Room,type Session} from '../multiplayer/session';
import type {RoomActions} from '../multiplayer/RoomActions';
import {playerError} from '../multiplayer/playerError';
import {GameRequestError} from '../multiplayer/PendingGameAction';
import type {InvitePlayer} from '../multiplayer/inviteSuggestions';
import {useCreationProgress} from './CreationCards';
import type {OriginalDistributedRuntime} from '../multiplayer/OriginalDistributedRuntime';
type Game='flush'|'marriage'|'callbreak';

export function CreateTableSheet({visible=true,runtime,session,rooms,playerName,roomActions,onClose,onCreated}:{
  visible?:boolean;runtime?:OriginalDistributedRuntime|null;session:Session;rooms:Room[];playerName:string;roomActions:RoomActions;onClose:()=>void;
  onCreated:(room:Room,game:Game,match:string)=>void;
}){
  const {colors:c}=useTheme();
  const creation=useCreationProgress(runtime);
  const pendingCreation=creation.cards.length>0;
  const formVisible=useRef(visible);formVisible.current=visible;
  const {id:cardTheme}=useCardTheme();
  const [game,setGame]=useState<Game>('flush'),[roomId,setRoomId]=useState(rooms[0]?.room_id??'');
  const [callbreakPlayers,setCallbreakPlayers]=useState<4|5>(4);
  const [dropdown,setDropdown]=useState(false);
  const [editingRoom,setEditingRoom]=useState(false),[roomDraft,setRoomDraft]=useState(''),[newRoomName,setNewRoomName]=useState('');
  function confirmRoom(){
    const base=roomDraft.trim().slice(0,60);if(!base)return;
    const names=new Set(rooms.map(room=>room.name.trim().toLocaleLowerCase()));
    let name=base,index=2;while(names.has(name.toLocaleLowerCase())){const suffix=` ${index++}`;name=base.slice(0,60-suffix.length)+suffix;}
    if(creating.current||pendingCreation||unselectedInviteQuery)return;
    setNewRoomName(name);if(defaultRoom.current?.name!==name)defaultRoom.current=null;
    void create(name);
  }
  const [cardThemeExpanded,setCardThemeExpanded]=useState(false);
  const [unselectedInviteQuery,setUnselectedInviteQuery]=useState(false);
  const [invitees,setInvitees]=useState<InvitePlayer[]>([]);
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const creating=useRef(false),defaultRoom=useRef<Room|null>(null);
  const selected=newRoomName?undefined:rooms.find(room=>room.room_id===roomId)??(!roomId?rooms[0]:undefined);
  const text={color:c.text,fontFamily:fonts.body},input={color:c.text,borderWidth:1,borderColor:c.border,borderRadius: radii.medium,padding:12,minHeight:48};
  async function create(inlineRoomName?:string){
    if(creating.current||pendingCreation||(editingRoom&&!inlineRoomName)||unselectedInviteQuery||rooms.length&&!selected&&!newRoomName&&!inlineRoomName)return;
    creating.current=true;setBusy(true);setError('');
    try{
      let room=inlineRoomName?defaultRoom.current:selected??defaultRoom.current;
      const name=inlineRoomName||newRoomName;
      if(runtime){
        const identity=playerName.trim()?null:await request<InvitePlayer>('/auth/me',session);
        const owner=playerName.trim()||identity?.display_name?.trim()||identity?.username?.trim()||ui('common.player');
        const result=await runtime.createGame(room,name||ui('rooms.default_room',{player:owner.slice(0,50)}),{game_type:game,card_theme:cardTheme,...(game==='callbreak'?{player_count:callbreakPlayers}:{}),invitees:invitees.map(player=>player.user_id),notify_room:true});
        if(result&&formVisible.current&&isCurrentSession(apiUrl,session))onCreated(result.room,game,result.matchId);
        return;
      }
      if(!room){
        const identity=playerName.trim()?null:await request<InvitePlayer>('/auth/me',session);
        const owner=playerName.trim()||identity?.display_name?.trim()||identity?.username?.trim();
        if(!owner)throw new Error(ui('rooms.create_failed'));
        if(!isCurrentSession(apiUrl,session))return;
        room=await roomActions.create(session,{name:name||ui('rooms.default_room',{player:owner.slice(0,50)}),visibility:'public',invitees:[]});defaultRoom.current=room;
      }
      if(!isCurrentSession(apiUrl,session))return;
      // Membership and table creation retain the runtime's durable command slots.
      await roomActions.enter(session,room.room_id);
      const result=await request<{match_id:string}>(`/test-games/${encodeURIComponent(room.room_id)}`,session,
        {game_type:game,card_theme:cardTheme,...(game==='callbreak'?{player_count:callbreakPlayers}:{}),invitees:invitees.map(player=>player.user_id),notify_room:true});
      if(formVisible.current&&isCurrentSession(apiUrl,session))onCreated(room,game,result.match_id);
    }catch(error){
      if(runtime&&error instanceof GameRequestError&&error.detail?.code==='PLAYER_ALREADY_AT_TABLE'){
        setError('');if(formVisible.current)onClose();
      }else setError(playerError(error,ui('rooms.create_failed')));
    }
    finally{creating.current=false;setBusy(false);}
  }
  const [inviteSuggestionsExpanded,setInviteSuggestionsExpanded]=useState(false);
  const createDisabled=busy||pendingCreation||unselectedInviteQuery||(editingRoom?!roomDraft.trim():(rooms.length>0&&!selected&&!newRoomName));
  return <RoomSheet visible={visible} scrollEnabled={!dropdown && !cardThemeExpanded && !inviteSuggestionsExpanded} presentation="dialog" testID="create-game-table" title={ui('rooms.create_table')} closeLabel={ui('rooms.close_create_table')} onClose={onClose}
    footer={<View testID="create-game-footer" style={{padding:16,paddingTop:12,borderTopWidth:1,borderColor:c.tableTrim,backgroundColor:c.tableHeader,gap:8,flexShrink:0}}><Pressable accessibilityRole="button" accessibilityLabel={ui('rooms.create_table')} disabled={createDisabled} accessibilityState={{disabled:createDisabled}}
      onPress={()=>editingRoom?confirmRoom():void create()} style={{minHeight:56,borderRadius: radii.medium,alignItems:'center',justifyContent:'center',backgroundColor:c.primary,borderWidth:2,borderColor:c.onPrimary,opacity:createDisabled?visualStates.disabledOpacity:1,flexDirection:'row',gap:10}}><Ionicons name="add-circle-outline" size={22} color={c.onPrimary}/><Text activity style={{color:c.onPrimary,fontFamily:fonts.medium,fontSize:16}}>{busy?ui('social.sending'):ui('rooms.create_table')}</Text></Pressable></View>}>
    <View style={{padding:16,gap:14}}>
<CreateTableForm onUnselectedInviteQueryChange={setUnselectedInviteQuery} onInviteSuggestionsExpandedChange={setInviteSuggestionsExpanded} onCardThemeExpandedChange={setCardThemeExpanded} session={session} game={game} setGame={setGame} callbreakPlayers={callbreakPlayers} setCallbreakPlayers={setCallbreakPlayers} invitees={invitees} setInvitees={setInvitees} busy={busy} roomSelector={<View style={{ position: 'relative', zIndex: 50, gap: 8, minWidth:0, width:'100%' }}>
      {<>
      <Text style={{...text,fontFamily:fonts.medium}}>{ui('rooms.choose_room')}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={ui('rooms.select_room')} accessibilityState={{expanded:dropdown,disabled:busy}} disabled={busy} onPress={()=>setDropdown(open=>!open)} style={{...input,flexDirection:'row',alignItems:'center',gap:10}}>
        <Text style={{...text,flex:1,minWidth:0}}>{newRoomName||selected?.name||ui('rooms.create_in_new_room')}</Text><Ionicons name={dropdown?'chevron-up':'chevron-down'} size={18} color={c.text}/>
      </Pressable>
      {dropdown&&<View testID="create-room-dropdown" style={{position:'absolute',top:'100%',marginTop:4,left:0,right:0,zIndex:100,elevation:24,borderWidth:1,borderColor:c.border,borderRadius:radii.medium,backgroundColor:c.surface,overflow:'hidden'}}><ScrollView testID="create-room-options" nestedScrollEnabled style={{maxHeight:144,flexGrow:0}} keyboardShouldPersistTaps="handled">{rooms.map(room=><Pressable key={room.room_id} accessibilityRole="button" accessibilityState={{selected:selected?.room_id===room.room_id}} onPress={()=>{setRoomId(room.room_id);setNewRoomName('');setEditingRoom(false);setDropdown(false);}} style={{padding:12,height:48,justifyContent:'center',backgroundColor:selected?.room_id===room.room_id?c.surfaceSelected:c.surface}}><Text numberOfLines={1} style={text}>{room.name}</Text></Pressable>)}</ScrollView>{editingRoom?<View style={{flexDirection:'row',alignItems:'center',height:48,paddingHorizontal:8,gap:4,minWidth:0,width:'100%'}}><FormInput autoFocus editable={!busy&&!pendingCreation} accessibilityLabel={ui('rooms.new_room_name')} placeholder={ui('rooms.new_room_name')} value={roomDraft} onChangeText={setRoomDraft} maxLength={60} onSubmitEditing={confirmRoom} returnKeyType="go" style={{...text,flex:1,minWidth:0,width:0,height:44,paddingHorizontal:4}}/><Pressable accessibilityRole="button" accessibilityLabel={ui('rooms.create_table_in_new_room')} disabled={!roomDraft.trim()||busy||pendingCreation||unselectedInviteQuery} onPress={confirmRoom} style={{width:44,height:44,alignItems:'center',justifyContent:'center',borderRadius:radii.medium,backgroundColor:c.primary,opacity:roomDraft.trim()&&!busy&&!pendingCreation&&!unselectedInviteQuery?1:visualStates.disabledOpacity}}><Ionicons name="arrow-forward" size={22} color={c.onPrimary}/></Pressable></View>:<Pressable accessibilityRole="button" accessibilityLabel={ui('rooms.create_in_new_room')} onPress={()=>{setRoomDraft('');setEditingRoom(true);}} style={{height:48,paddingHorizontal:12,flexDirection:'row',alignItems:'center',gap:8,minWidth:0}}><Ionicons name="add" size={20} color={c.text}/><Text numberOfLines={1} style={{...text,flex:1,minWidth:0}}>{ui('rooms.create_in_new_room')}</Text></Pressable>}</View>}

      </>}
</View>}/>
      {!!error&&<Text activity accessibilityRole="alert" style={{color:c.danger}}>{error}</Text>}
    </View>
  </RoomSheet>;
}
