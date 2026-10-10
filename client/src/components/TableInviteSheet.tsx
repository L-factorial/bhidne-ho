import {useRef,useState} from 'react';
import {ActivityIndicator,Pressable,View} from 'react-native';
import {AppText as Text} from './AppText';
import {RoomSheet} from './RoomSheet';
import {FormInput} from './FormInput';
import {useInviteSuggestions} from '../multiplayer/useInviteSuggestions';
import type {InvitePlayer} from '../multiplayer/inviteSuggestions';
import type {Session} from '../multiplayer/session';
import {request} from '../multiplayer/api';
import {playerError} from '../multiplayer/playerError';
import {ui} from '../i18n/copy';
import {useUiLanguage} from '../i18n/useUiLanguage';
import {fonts,radii,useTheme} from '../theme';

export function TableInviteSheet({session,roomId,matchId,visible,onClose}:{session:Session;roomId:string;matchId:string;visible:boolean;onClose:()=>void}){
  useUiLanguage();
  const {colors:c}=useTheme();
  const [query,setQuery]=useState(''),[selected,setSelected]=useState<InvitePlayer[]>([]);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[sent,setSent]=useState(false);
  const submitting=useRef(false);
  const suggestions=useInviteSuggestions(session,query,selected,busy||!visible);
  const text={color:c.text,fontFamily:fonts.body};
  const button={minHeight:48,padding:12,borderRadius:radii.medium,borderWidth:1,borderColor:c.border};
  async function send(){
    if(submitting.current||!selected.length||query.trim())return;
    submitting.current=true;setBusy(true);setError('');setSent(false);
    try{
      await request(`/test-games/${encodeURIComponent(roomId)}/table/invite-table`,session,{match_id:matchId,recipients:selected.map(player=>player.user_id)});
      setSent(true);setSelected([]);setQuery('');
    }catch(failure){setError(playerError(failure));}
    finally{submitting.current=false;setBusy(false);}
  }
  return <RoomSheet visible={visible} title={ui('rooms.invite_players')} onClose={onClose} testID="table-invite-sheet"
    footer={<Pressable accessibilityRole="button" accessibilityLabel={ui('rooms.send_invitations')} disabled={busy||!selected.length||!!query.trim()} accessibilityState={{disabled:busy||!selected.length||!!query.trim()}} onPress={()=>void send()} style={{...button,backgroundColor:c.primary,alignItems:'center',opacity:busy||!selected.length||!!query.trim()?0.55:1}}>
      {busy?<ActivityIndicator color={c.onPrimary}/>:<Text style={{color:c.onPrimary,fontFamily:fonts.medium}}>{ui('rooms.send_invitations')}</Text>}
    </Pressable>}>
    <Text style={{...text,color:c.textMuted}}>{ui('rooms.busy_invitation_help')}</Text>
    {!!query.trim()&&<Text style={{...text,color:c.accent}}>{ui('rooms.select_or_clear_invite_search')}</Text>}
    <FormInput accessibilityLabel={ui('rooms.find_player_to_invite')} placeholder={ui('rooms.username_or_user_id')} placeholderTextColor={c.textMuted} value={query} onChangeText={value=>{setQuery(value);setSent(false);}} editable={!busy} maxLength={64} autoCapitalize="none" autoCorrect={false} style={{...button,...text}}/>
    {!!selected.length&&<View style={{gap:8}}>{selected.map(player=><Pressable key={player.user_id} accessibilityRole="button" accessibilityLabel={ui('rooms.remove_player',{player:player.display_name||player.username||player.user_id})} disabled={busy} onPress={()=>setSelected(current=>current.filter(item=>item.user_id!==player.user_id))} style={{...button,backgroundColor:c.surfaceSelected}}><Text style={text}>{player.display_name||player.username||player.user_id} ×</Text></Pressable>)}</View>}
    {suggestions.players.map(player=><Pressable key={player.user_id} accessibilityRole="button" accessibilityLabel={ui('rooms.invite_player',{player:player.display_name||player.username||player.user_id})} disabled={busy||selected.length>=20} onPress={()=>{setSelected(current=>current.length>=20||current.some(item=>item.user_id===player.user_id)?current:[...current,player]);setQuery('');setSent(false);}} style={button}><Text style={text}>{player.display_name||player.username||player.user_id}</Text>{!!player.username&&<Text style={{...text,color:c.textMuted}}>@{player.username}</Text>}</Pressable>)}
    {suggestions.searching&&<ActivityIndicator color={c.accent}/>}
    {!suggestions.searching&&query.trim().length>=3&&!suggestions.players.length&&!suggestions.error&&<Text style={text}>{ui('rooms.no_matching_players')}</Text>}
    {query.trim().length<3&&<Text style={{...text,color:c.textMuted}}>{ui('rooms.select_invite_player_help')}</Text>}
    {!!(error||suggestions.error)&&<Text accessibilityRole="alert" style={{color:c.danger}}>{error||suggestions.error}</Text>}
    {sent&&<Text accessibilityLiveRegion="polite" style={{color:c.success}}>{ui('rooms.invitations_sent')}</Text>}
  </RoomSheet>;
}
