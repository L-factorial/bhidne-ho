import {AppText as Text} from './AppText';
import {useEffect,useState,type ReactNode} from 'react';
import {Ionicons} from '@expo/vector-icons';
import {Pressable, ScrollView, View} from 'react-native';
import {FormInput} from './FormInput';
import {CreateCardThemeSelector} from './CardThemePicker';
import {GameIcon} from './BrandArt';
import { radii, fonts,useTheme} from '../theme';
import {ui} from '../i18n/copy';
import {gameLabel} from '../i18n/display';
import type {Session} from '../multiplayer/session';
import {useInviteSuggestions} from '../multiplayer/useInviteSuggestions';
import type {InvitePlayer} from '../multiplayer/inviteSuggestions';
export type CreateGame='flush'|'marriage'|'callbreak';
export function CreateTableForm({session,game,setGame,callbreakPlayers,setCallbreakPlayers,invitees,setInvitees,busy,roomSelector,onCardThemeExpandedChange,onInviteSuggestionsExpandedChange}:{session:Session;game:CreateGame;setGame:(game:CreateGame)=>void;callbreakPlayers:4|5;setCallbreakPlayers:(count:4|5)=>void;invitees:InvitePlayer[];setInvitees:React.Dispatch<React.SetStateAction<InvitePlayer[]>>;busy:boolean;roomSelector?:ReactNode;onCardThemeExpandedChange?:(expanded:boolean)=>void;onInviteSuggestionsExpandedChange?:(expanded:boolean)=>void}){
 const {colors:c}=useTheme();
 const [query,setQuery]=useState('');
 const [suggestionRowHeight,setSuggestionRowHeight]=useState(44);
 const suggestions=useInviteSuggestions(session,query,invitees,busy);
 const suggestionsOpen = suggestions.players.length > 0;
 useEffect(()=>{onInviteSuggestionsExpandedChange?.(suggestionsOpen);return ()=>onInviteSuggestionsExpandedChange?.(false);},[suggestionsOpen,onInviteSuggestionsExpandedChange]);
 const text={color:c.text,fontFamily:fonts.body},input={color:c.text,borderWidth:1,borderColor:c.border,borderRadius: radii.medium,padding:12,minHeight:48};
 return <View style={{gap:14}}>
      <Text style={{...text,fontFamily:fonts.medium}}>{ui('rooms.choose_game_type')}</Text>
      <View accessibilityRole="tablist" style={{flexDirection:'row',flexWrap:'wrap',gap:8}}>
        {(['flush','marriage','callbreak'] as const).map(value=><Pressable key={value} accessibilityRole="tab" accessibilityLabel={gameLabel(value)} disabled={busy} accessibilityState={{selected:game===value,disabled:busy}} onPress={()=>setGame(value)} style={{minHeight:88,paddingHorizontal:12,alignItems:'center',gap:6,flex:1,borderRadius: radii.medium,borderWidth:1,borderColor:game===value?c.accent:c.border,backgroundColor:game===value?c.surfaceSelected:c.surface,justifyContent:'center'}}><GameIcon game={value} size={40}/><Text style={{color:game===value?c.accent:c.text,fontFamily:fonts.medium}}>{gameLabel(value)}</Text></Pressable>)}
      </View>
      {game==='callbreak'&&<View accessibilityRole="radiogroup" accessibilityLabel={ui('rooms.player_count')} style={{gap:8}}>
        <Text style={{...text,fontFamily:fonts.medium}}>{ui('rooms.player_count')}</Text>
        <View style={{flexDirection:'row',gap:8}}>{([4,5] as const).map(count=><Pressable key={count} accessibilityRole="radio" accessibilityLabel={ui('rooms.players_option',{count})} accessibilityState={{checked:callbreakPlayers===count,disabled:busy}} aria-checked={callbreakPlayers===count} disabled={busy} onPress={()=>setCallbreakPlayers(count)} style={{minHeight:44,paddingHorizontal:16,justifyContent:'center',borderRadius: radii.medium,borderWidth:1,borderColor:callbreakPlayers===count?c.accent:c.border,backgroundColor:callbreakPlayers===count?c.surfaceSelected:c.surface}}><Text style={{...text,color:callbreakPlayers===count?c.accent:c.text}}>{ui('rooms.players_option',{count})}</Text></Pressable>)}</View>
      </View>}
<CreateCardThemeSelector disabled={busy} overlay onExpandedChange={onCardThemeExpandedChange}/>
{roomSelector}
      <Text style={{...text,fontFamily:fonts.medium}}>{ui('rooms.invite_people_optional')}</Text>
      <View style={{gap:4,zIndex:suggestionsOpen?100:0}}>
        <View testID="invite-search-anchor" style={{position:'relative'}}>
        <FormInput accessibilityLabel={ui('rooms.find_player_to_invite')} placeholder={ui('rooms.username_or_user_id')} placeholderTextColor={c.textMuted} autoCapitalize="none" autoCorrect={false} value={query} onChangeText={setQuery} maxLength={64} editable={!busy} style={input}/>
        {suggestionsOpen&&<View testID="invite-player-suggestions" style={{position:'absolute',top:'100%',marginTop:4,left:0,right:0,zIndex:100,elevation:24,borderWidth:1,borderColor:c.borderSubtle,borderRadius:12,overflow:'hidden',backgroundColor:c.surfaceRaised,shadowColor:'#000',shadowOpacity:0.18,shadowRadius:8,shadowOffset:{width:0,height:3}}}>
          <ScrollView nestedScrollEnabled keyboardShouldPersistTaps="always" style={{maxHeight:suggestionRowHeight*4}}>
          {suggestions.players.map((player,index)=><Pressable key={player.user_id} onLayout={index===0?e=>setSuggestionRowHeight(Math.ceil(e.nativeEvent.layout.height)):undefined} accessibilityRole="button" accessibilityLabel={ui('rooms.invite_player',{player:player.display_name||player.username||player.user_id})} disabled={busy||invitees.length>=20} accessibilityState={{disabled:busy||invitees.length>=20}} onPress={()=>{
            setInvitees(current=>current.length>=20||current.some(item=>item.user_id===player.user_id)?current:[...current,player]);setQuery('');
          }} style={({pressed})=>({minHeight:44,paddingHorizontal:12,paddingVertical:8,flexDirection:'row',alignItems:'center',gap:8,backgroundColor:pressed?c.surfaceSelected:c.surfaceRaised})}><Text numberOfLines={1} style={{...text,fontFamily:fonts.medium,flexShrink:1}}>{player.display_name||player.username||player.user_id}</Text>{!!player.username&&<Text numberOfLines={1} style={{color:c.textMuted,fontSize:13,flexShrink:1}}>@{player.username}</Text>}</Pressable>)}
          </ScrollView>
        </View>}
        </View>
        {query.trim().length<3&&<Text style={{...text,color:c.textMuted}}>{ui('rooms.invite_search_help')}</Text>}
        {suggestions.searching&&<Text accessibilityLiveRegion="polite" style={{...text,color:c.textMuted}}>{ui('rooms.finding_players')}</Text>}
        {!suggestions.searching&&!suggestions.error&&query.trim().length>=3&&!suggestions.players.length&&<Text style={{...text,color:c.textMuted}}>{ui('rooms.no_matching_players')}</Text>}
        {!!suggestions.error&&<Text accessibilityRole="alert" style={{color:c.danger}}>{suggestions.error}</Text>}
      </View>
      {!!invitees.length&&<View testID="selected-invite-players" style={{gap:6}}>
        <Text style={{...text,fontFamily:fonts.medium}}>{ui('rooms.invited_players')}</Text>
        <View testID="invite-player-chips" style={{flexDirection:'row',flexWrap:'wrap',gap:8}}>
        {invitees.map(player=><View key={player.user_id} style={{flexDirection:'row',alignItems:'center',alignSelf:'flex-start',maxWidth:'100%',paddingLeft:12,borderRadius:24,borderWidth:1,borderColor:c.border,backgroundColor:c.surfaceSelected}}>
          <Text numberOfLines={1} style={{...text,fontSize:14,flexShrink:1}}>{player.display_name||player.username||player.user_id}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={ui('rooms.remove_player',{player:player.display_name||player.username||player.user_id})} disabled={busy} accessibilityState={{disabled:busy}} onPress={()=>setInvitees(current=>current.filter(item=>item.user_id!==player.user_id))} style={{minWidth:44,minHeight:44,flexShrink:0,alignItems:'center',justifyContent:'center'}}><Ionicons name="close" size={20} color={c.text}/></Pressable>
        </View>)}
        </View>
      </View>}
      <Text style={{...text,color:c.textMuted}}>{ui('rooms.notify_room_help')}</Text>
</View>;
}
