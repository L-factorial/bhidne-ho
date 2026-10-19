import {useEffect, useRef, useState} from 'react';
import {Keyboard, Platform, Pressable, ScrollView, View, useWindowDimensions} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {AppText as Text} from './AppText';
import {ActivityLine} from './ActivityLine';
import {PlayerAvatar} from './PlayerAvatar';
import {FormInput} from './FormInput';
import {GameModal} from './GameModal';
import {KeyboardFrame} from './KeyboardFrame';
import {CommunityRulesEntry} from './moderation/CommunityRules';
import {useInviteSuggestions} from '../multiplayer/useInviteSuggestions';
import {playerError} from '../multiplayer/playerError';
import type {Session} from '../multiplayer/session';
import {ui} from '../i18n/copy';
import {useUiLanguage} from '../i18n/useUiLanguage';
import {fonts, radii, useTheme} from '../theme';

type Bounds = {x:number;y:number;width:number;height:number};
const measure = (node:View) => new Promise<Bounds>(resolve => node.measureInWindow((x,y,width,height)=>resolve({x,y,width,height})));

/** A single recipient, anchored from the tapped seat toward the table center. */
export function SeatInvitePopover({session,position,nodes,onClose,onInvite}:{session:Session;position:number;nodes:Map<number,View>;onClose:()=>void;onInvite:(recipient:string)=>Promise<unknown>}) {
  useUiLanguage();
  const {colors:c}=useTheme(),insets=useSafeAreaInsets(),window=useWindowDimensions();
  const root=useRef<View>(null),submitting=useRef(false);
  const [query,setQuery]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [frame,setFrame]=useState<Bounds|null>(null),[seats,setSeats]=useState<Bounds[]>([]),[anchor,setAnchor]=useState<Bounds|null>(null),[height,setHeight]=useState(116);
  const needle=query.trim().replace(/^@/,'');
  const suggestions=useInviteSuggestions(session,needle,[],busy);
  useEffect(()=>{
    let current=true;
    async function update(){
      const seat=nodes.get(position),container=root.current;
      if(!seat||!container)return;
      const [bounds,selected,all]=await Promise.all([measure(container),measure(seat),Promise.all([...nodes.values()].map(measure))]);
      if(current){setFrame(bounds);setAnchor(selected);setSeats(all);}
    }
    void update();
    return()=>{current=false;};
  },[position,nodes,window.width,window.height,frame?.width,frame?.height]);
  async function send(recipient:string){
    if(submitting.current||busy||suggestions.searching||!suggestions.players.some(player=>player.user_id===recipient))return;
    submitting.current=true;setBusy(true);setError('');
    try{await onInvite(recipient);Keyboard.dismiss();}
    catch(failure){setError(playerError(failure));}
    finally{submitting.current=false;setBusy(false);}
  }
  const width=Math.min(208,Math.max(0,(frame?.width??window.width)-insets.left-insets.right-16));
  let left=8,top=8;
  if(frame&&anchor&&seats.length){
    const cx=(Math.min(...seats.map(s=>s.x))+Math.max(...seats.map(s=>s.x+s.width)))/2;
    const cy=(Math.min(...seats.map(s=>s.y))+Math.max(...seats.map(s=>s.y+s.height)))/2;
    const ax=anchor.x+anchor.width/2,ay=anchor.y+Math.min(anchor.height/2,44);
    const dx=cx-ax,dy=cy-ay,length=Math.hypot(dx,dy)||1,ux=dx/length,uy=dy/length;
    const distance=Math.min(Math.abs(ux)>.01?(anchor.width+width)/2/Math.abs(ux):Infinity,Math.abs(uy)>.01?(88+height)/2/Math.abs(uy):Infinity)+8;
    left=ax+ux*distance-width/2-frame.x;
    top=ay+uy*distance-height/2-frame.y;
  }
  left=Math.max(insets.left+8,Math.min(left,(frame?.width??window.width)-insets.right-width-8));
  top=Math.max(insets.top+8,Math.min(top,(frame?.height??window.height)-insets.bottom-height-8));
  return <GameModal transparent visible animationType={Platform.OS==='web'?'none':'fade'} onRequestClose={onClose}>
    <KeyboardFrame><View ref={root} style={{flex:1,minHeight:0}} onLayout={()=>root.current?.measureInWindow((x,y,width,height)=>setFrame({x,y,width,height}))}>
      <Pressable testID="seat-invite-dismiss" accessibilityRole="button" accessibilityLabel={ui('common.close')} onPress={()=>{Keyboard.dismiss();onClose();}} style={{position:'absolute',inset:0}}/>
      <View testID="seat-invite-popover" accessibilityViewIsModal onLayout={event=>setHeight(event.nativeEvent.layout.height)} style={{position:'absolute',left,top,width,padding:8,gap:6,borderRadius:radii.medium,backgroundColor:c.surface,borderWidth:1,borderColor:c.accent,boxShadow:'0px 4px 18px rgba(0,0,0,0.28)',opacity:anchor?1:0}}>
        <FormInput testID="seat-invite-input" accessibilityLabel={ui('rooms.find_player_to_invite')} placeholder={ui('rooms.username_or_user_id')} placeholderTextColor={c.textMuted} value={query} onChangeText={value=>{setQuery(value);setError('');}} editable={!busy} maxLength={64} autoCapitalize="none" autoCorrect={false} returnKeyType="search" style={{minHeight:40,padding:6,borderWidth:1,borderColor:c.border,borderRadius:8,color:c.text,fontFamily:fonts.body,fontSize:14}}/>
        {!!suggestions.players.length&&<ScrollView testID="seat-invite-results" keyboardShouldPersistTaps="always" style={{height:Math.max(44,Math.min(Math.min(suggestions.players.length,3)*44,(frame?.height??window.height)-insets.top-insets.bottom-120))}}>
          {suggestions.players.map(player=><Pressable key={player.user_id} testID={`seat-invite-player-${player.user_id}`} accessibilityRole="button" accessibilityLabel={`${ui('rooms.send_invitation')} · ${player.display_name}${player.username?` @${player.username}`:''}`} disabled={busy||suggestions.searching} accessibilityState={{disabled:busy||suggestions.searching}} onPress={()=>void send(player.user_id)}
            style={({pressed})=>({height:44,paddingVertical:4,paddingHorizontal:2,flexDirection:'row',alignItems:'center',gap:6,borderRadius:8,backgroundColor:pressed?c.surfaceSelected:c.surface,opacity:(busy||suggestions.searching)?0.55:1})}>
            <PlayerAvatar size={24}/>
            <View style={{flex:1,minWidth:0}}><Text numberOfLines={1} style={{color:c.text,fontFamily:fonts.medium,fontSize:13,lineHeight:16}}>{player.display_name}</Text>
              {!!player.username&&<Text numberOfLines={1} style={{color:c.textMuted,fontSize:11,lineHeight:14}}>@{player.username}</Text>}
            </View>
          </Pressable>)}
        </ScrollView>}
        {(busy||suggestions.searching)&&<ActivityLine/>}
        {error===ui('feedback.community_rules_required')&&<CommunityRulesEntry session={session} onAccepted={()=>setError('')}/>}
        {!!(error||suggestions.error)&&<Text accessibilityRole="alert" style={{fontSize:12,color:c.danger}}>{error||suggestions.error}</Text>}
        {!busy&&!suggestions.searching&&!suggestions.players.length&&needle.length>=3&&!error&&!suggestions.error&&<Text style={{fontSize:12,color:c.textMuted}}>{ui('rooms.no_matching_players')}</Text>}
      </View>
    </View></KeyboardFrame>
  </GameModal>;
}
