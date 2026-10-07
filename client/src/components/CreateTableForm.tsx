import {AppText as Text} from './AppText';
import {useState,type ReactNode} from 'react';
import {Ionicons} from '@expo/vector-icons';
import {Pressable, View} from 'react-native';
import {FormInput} from './FormInput';
import {GameIcon} from './BrandArt';
import {fonts,useTheme} from '../theme';
import {ui} from '../i18n/copy';
import {gameLabel} from '../i18n/display';
import type {Session} from '../multiplayer/session';
import {useInviteSuggestions} from '../multiplayer/useInviteSuggestions';
import type {InvitePlayer} from '../multiplayer/inviteSuggestions';
export type CreateGame='flush'|'marriage'|'callbreak';
export function CreateTableForm({session,game,setGame,callbreakPlayers,setCallbreakPlayers,name,setName,invitees,setInvitees,busy,roomSelector}:{session:Session;game:CreateGame;setGame:(game:CreateGame)=>void;callbreakPlayers:4|5;setCallbreakPlayers:(count:4|5)=>void;name:string;setName:(name:string)=>void;invitees:InvitePlayer[];setInvitees:React.Dispatch<React.SetStateAction<InvitePlayer[]>>;busy:boolean;roomSelector?:ReactNode}){
 const {colors:c}=useTheme();
 const [query,setQuery]=useState('');
 const suggestions=useInviteSuggestions(session,query,invitees,busy);
 const text={color:c.text,fontFamily:fonts.body},input={color:c.text,borderWidth:1,borderColor:c.border,borderRadius:12,padding:12,minHeight:48};
 return <View style={{gap:14}}>
      <Text style={{...text,fontFamily:fonts.medium}}>{ui('rooms.choose_game_type')}</Text>
      <View accessibilityRole="tablist" style={{flexDirection:'row',flexWrap:'wrap',gap:8}}>
        {(['flush','marriage','callbreak'] as const).map(value=><Pressable key={value} accessibilityRole="tab" accessibilityLabel={gameLabel(value)} disabled={busy} accessibilityState={{selected:game===value,disabled:busy}} onPress={()=>setGame(value)} style={{minHeight:88,paddingHorizontal:12,alignItems:'center',gap:6,flex:1,borderRadius:12,borderWidth:1,borderColor:game===value?c.accent:c.border,backgroundColor:game===value?c.surfaceSelected:c.surface,justifyContent:'center'}}><GameIcon game={value} size={40}/><Text style={{color:game===value?c.accent:c.text,fontFamily:fonts.medium}}>{gameLabel(value)}</Text></Pressable>)}
      </View>
      {game==='callbreak'&&<View accessibilityRole="radiogroup" accessibilityLabel={ui('rooms.player_count')} style={{gap:8}}>
        <Text style={{...text,fontFamily:fonts.medium}}>{ui('rooms.player_count')}</Text>
        <View style={{flexDirection:'row',gap:8}}>{([4,5] as const).map(count=><Pressable key={count} accessibilityRole="radio" accessibilityLabel={ui('rooms.players_option',{count})} accessibilityState={{checked:callbreakPlayers===count,disabled:busy}} aria-checked={callbreakPlayers===count} disabled={busy} onPress={()=>setCallbreakPlayers(count)} style={{minHeight:44,paddingHorizontal:16,justifyContent:'center',borderRadius:12,borderWidth:1,borderColor:callbreakPlayers===count?c.accent:c.border,backgroundColor:callbreakPlayers===count?c.surfaceSelected:c.surface}}><Text style={{...text,color:callbreakPlayers===count?c.accent:c.text}}>{ui('rooms.players_option',{count})}</Text></Pressable>)}</View>
      </View>}
{roomSelector}
      <FormInput accessibilityLabel={ui('rooms.table_name')} placeholder={ui('rooms.table_name')} placeholderTextColor={c.textMuted} value={name} onChangeText={setName} maxLength={60} editable={!busy} style={input}/>
      <Text style={{...text,fontFamily:fonts.medium}}>{ui('rooms.invite_people_optional')}</Text>
      <View style={{gap:4}}>
        <FormInput accessibilityLabel={ui('rooms.find_player_to_invite')} placeholder={ui('rooms.username_or_user_id')} placeholderTextColor={c.textMuted} autoCapitalize="none" autoCorrect={false} value={query} onChangeText={setQuery} maxLength={64} editable={!busy} style={input}/>
        {!!suggestions.players.length&&<View testID="invite-player-suggestions" style={{borderWidth:1,borderColor:c.border,borderRadius:12,overflow:'hidden',backgroundColor:c.surfaceRaised}}>
          {suggestions.players.map(player=><Pressable key={player.user_id} accessibilityRole="button" accessibilityLabel={ui('rooms.invite_player',{player:player.display_name||player.username||player.user_id})} disabled={busy||invitees.length>=20} accessibilityState={{disabled:busy||invitees.length>=20}} onPress={()=>{
            setInvitees(current=>current.length>=20||current.some(item=>item.user_id===player.user_id)?current:[...current,player]);setQuery('');
          }} style={{minHeight:48,padding:12,gap:3}}><Text style={{...text,fontFamily:fonts.medium}}>{player.display_name||player.username||player.user_id}</Text>{!!player.username&&<Text style={{color:c.textMuted}}>@{player.username}</Text>}</Pressable>)}
        </View>}
        {query.trim().length<3&&<Text style={{...text,color:c.textMuted}}>{ui('rooms.invite_search_help')}</Text>}
        {suggestions.searching&&<Text accessibilityLiveRegion="polite" style={{...text,color:c.textMuted}}>{ui('rooms.finding_players')}</Text>}
        {!suggestions.searching&&!suggestions.error&&query.trim().length>=3&&!suggestions.players.length&&<Text style={{...text,color:c.textMuted}}>{ui('rooms.no_matching_players')}</Text>}
        {!!suggestions.error&&<Text accessibilityRole="alert" style={{color:c.danger}}>{suggestions.error}</Text>}
      </View>
      {!!invitees.length&&<View testID="selected-invite-players" style={{gap:6}}>
        <Text style={{...text,fontFamily:fonts.medium}}>{ui('rooms.invited_players')}</Text>
        {invitees.map(player=><View key={player.user_id} style={{flexDirection:'row',alignItems:'center',paddingLeft:12,borderRadius:12,borderWidth:1,borderColor:c.border,backgroundColor:c.surfaceSelected}}>
          <Text style={{...text,flex:1}}>{player.display_name||player.username||player.user_id}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={ui('rooms.remove_player',{player:player.display_name||player.username||player.user_id})} disabled={busy} accessibilityState={{disabled:busy}} onPress={()=>setInvitees(current=>current.filter(item=>item.user_id!==player.user_id))} style={{minWidth:44,minHeight:44,alignItems:'center',justifyContent:'center'}}><Ionicons name="close" size={20} color={c.text}/></Pressable>
        </View>)}
      </View>}
      <Text style={{...text,color:c.textMuted}}>{ui('rooms.notify_room_help')}</Text>
</View>;
}
