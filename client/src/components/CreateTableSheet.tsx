import {useRef,useState} from 'react';
import {Ionicons} from '@expo/vector-icons';
import {Pressable,Text,View} from 'react-native';
import {RoomSheet} from './RoomSheet';
import {FormInput} from './FormInput';
import {fonts,useTheme} from '../theme';
import {ui} from '../i18n/copy';
import {gameLabel} from '../i18n/display';
import {request,apiUrl} from '../multiplayer/api';
import {isCurrentSession,type Room,type Session} from '../multiplayer/session';
import type {RoomActions} from '../multiplayer/RoomActions';
import {playerError} from '../multiplayer/playerError';
type Game='flush'|'marriage'|'callbreak';
type Player={user_id:string;display_name:string;username?:string|null};

export function CreateTableSheet({session,rooms,playerName,roomActions,onClose,onCreated}:{
  session:Session;rooms:Room[];playerName:string;roomActions:RoomActions;onClose:()=>void;
  onCreated:(room:Room,game:Game,match:string)=>void;
}){
  const {colors:c}=useTheme();
  const [game,setGame]=useState<Game>('flush'),[roomId,setRoomId]=useState(rooms[0]?.room_id??'');
  const [dropdown,setDropdown]=useState(false),[name,setName]=useState(''),[query,setQuery]=useState('');
  const [players,setPlayers]=useState<Player[]>([]),[invitees,setInvitees]=useState<Player[]>([]);
  const [busy,setBusy]=useState(false),[searching,setSearching]=useState(false),[error,setError]=useState('');
  const creating=useRef(false),defaultRoom=useRef<Room|null>(null);
  const defaultName=ui('rooms.default_room',{player:playerName.trim().slice(0,50)||ui('common.player')});
  const selected=rooms.find(room=>room.room_id===roomId)??(!roomId?rooms[0]:undefined);
  const text={color:c.text,fontFamily:fonts.body},input={color:c.text,borderWidth:1,borderColor:c.border,borderRadius:12,padding:12,minHeight:48};
  async function search(){
    if(searching||query.trim().length<2)return;
    setSearching(true);setError('');
    try{
      const result=await request<Player[]>(`/players/directory?q=${encodeURIComponent(query.trim())}`,session);
      if(!isCurrentSession(apiUrl,session))return;
      setPlayers(result.filter(player=>player.user_id!==session.user_id));
      if(!result.length)setError(ui('feedback.no_player_found_with_that_exact_name_username_or_user_id'));
    }catch(error){setError(playerError(error));}finally{setSearching(false);}
  }
  async function create(){
    if(creating.current||!name.trim()||rooms.length&&!selected)return;
    creating.current=true;setBusy(true);setError('');
    try{
      let room=selected??defaultRoom.current;
      if(!room){
        const identity=playerName.trim()?null:await request<Player>('/auth/me',session);
        const owner=playerName.trim()||identity?.display_name?.trim()||identity?.username?.trim();
        if(!owner)throw new Error(ui('rooms.create_failed'));
        if(!isCurrentSession(apiUrl,session))return;
        room=await roomActions.create(session,{name:ui('rooms.default_room',{player:owner.slice(0,50)}),visibility:'public',invitees:[]});defaultRoom.current=room;
      }
      if(!isCurrentSession(apiUrl,session))return;
      // Membership and table creation retain the runtime's durable command slots.
      await roomActions.enter(session,room.room_id);
      const result=await request<{match_id:string}>(`/test-games/${encodeURIComponent(room.room_id)}`,session,
        {game_type:game,player_count:game==='flush'?10:game==='marriage'?5:4,name:name.trim(),invitees:invitees.map(player=>player.user_id),notify_room:true});
      if(isCurrentSession(apiUrl,session))onCreated(room,game,result.match_id);
    }catch(error){setError(playerError(error,ui('rooms.create_failed')));}
    finally{creating.current=false;setBusy(false);}
  }
  const button=(label:string,action:()=>void,disabled=false)=> <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} accessibilityState={{disabled}} onPress={action} style={{minHeight:44,paddingHorizontal:12,justifyContent:'center',opacity:disabled?0.5:1}}><Text style={{color:c.accent,fontFamily:fonts.medium}}>{label}</Text></Pressable>;
  return <RoomSheet visible presentation="dialog" testID="create-game-table" title={ui('rooms.create_table')} closeLabel={ui('rooms.close_create_table')} onClose={()=>{if(!busy)onClose();}}
    footer={<Pressable accessibilityRole="button" accessibilityLabel={ui('rooms.create_table')} disabled={busy||!name.trim()||rooms.length>0&&!selected} accessibilityState={{disabled:busy||!name.trim()||rooms.length>0&&!selected}}
      onPress={()=>void create()} style={{minHeight:52,borderRadius:12,alignItems:'center',justifyContent:'center',backgroundColor:c.successSurface,borderWidth:1,borderColor:c.success,opacity:busy||!name.trim()?0.5:1}}><Text style={{color:c.success,fontFamily:fonts.medium}}>{busy?ui('social.sending'):ui('rooms.create_table')}</Text></Pressable>}>
    <View style={{padding:16,gap:14}}>
      <Text style={text}>{ui('rooms.create_table_help')}</Text>
      <Text style={{...text,fontFamily:fonts.medium}}>{ui('rooms.choose_game_type')}</Text>
      <View accessibilityRole="tablist" style={{flexDirection:'row',flexWrap:'wrap',gap:8}}>
        {(['flush','marriage','callbreak'] as const).map(value=><Pressable key={value} accessibilityRole="tab" accessibilityLabel={gameLabel(value)} disabled={busy} accessibilityState={{selected:game===value,disabled:busy}} onPress={()=>setGame(value)} style={{minHeight:44,paddingHorizontal:14,borderRadius:12,borderWidth:1,borderColor:game===value?c.accent:c.border,backgroundColor:game===value?c.surfaceSelected:c.surface,justifyContent:'center'}}><Text style={{color:game===value?c.accent:c.text,fontFamily:fonts.medium}}>{gameLabel(value)}</Text></Pressable>)}
      </View>
      <Text style={{...text,fontFamily:fonts.medium}}>{ui('rooms.choose_room')}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={ui('rooms.select_room')} accessibilityState={{expanded:dropdown,disabled:busy||!rooms.length}} disabled={busy||!rooms.length} onPress={()=>setDropdown(open=>!open)} style={{...input,flexDirection:'row',alignItems:'center',gap:10}}>
        <Text style={{...text,flex:1}}>{selected?.name??defaultRoom.current?.name??defaultName}</Text><Ionicons name={dropdown?'chevron-up':'chevron-down'} size={18} color={c.text}/>
      </Pressable>
      {dropdown&&<View style={{borderWidth:1,borderColor:c.border,borderRadius:12}}>{rooms.map(room=><Pressable key={room.room_id} accessibilityRole="button" accessibilityState={{selected:selected?.room_id===room.room_id}} onPress={()=>{setRoomId(room.room_id);setDropdown(false);}} style={{padding:12,minHeight:44,backgroundColor:selected?.room_id===room.room_id?c.surfaceSelected:c.surface}}><Text style={text}>{room.name}</Text></Pressable>)}</View>}
      {!rooms.length&&<Text style={{...text,color:c.textMuted}}>{ui('rooms.default_room_help',{room:defaultName})}</Text>}
      <FormInput accessibilityLabel={ui('rooms.table_name')} placeholder={ui('rooms.table_name')} placeholderTextColor={c.textMuted} value={name} onChangeText={setName} maxLength={60} editable={!busy} style={input}/>
      <Text style={{...text,fontFamily:fonts.medium}}>{ui('rooms.invite_people_optional')}</Text>
      <View style={{flexDirection:'row',alignItems:'center',gap:8}}>
        <FormInput accessibilityLabel={ui('rooms.find_player_to_invite')} placeholder={ui('rooms.username_or_user_id')} placeholderTextColor={c.textMuted} autoCapitalize="none" autoCorrect={false} value={query} onChangeText={setQuery} maxLength={64} editable={!busy} style={{...input,flex:1,minWidth:0}} returnKeyType="search" onSubmitEditing={()=>void search()}/>
        {button(ui('rooms.search_players'),()=>void search(),busy||searching||query.trim().length<2)}
      </View>
      {invitees.map(player=><View key={player.user_id}>{button(ui('rooms.remove_player',{player:player.display_name||player.username||player.user_id}),()=>setInvitees(current=>current.filter(item=>item.user_id!==player.user_id)),busy)}</View>)}
      {players.filter(player=>!invitees.some(item=>item.user_id===player.user_id)).map(player=><View key={player.user_id}>{button(ui('rooms.invite_player',{player:player.display_name||player.username||player.user_id}),()=>setInvitees(current=>[...current,player]),busy||invitees.length>=20)}</View>)}
      <Text style={{...text,color:c.textMuted}}>{ui('rooms.notify_room_help')}</Text>
      {!!error&&<Text accessibilityRole="alert" style={{color:c.danger}}>{error}</Text>}
    </View>
  </RoomSheet>;
}
