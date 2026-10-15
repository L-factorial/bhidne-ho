import {useEffect, useRef, useState} from 'react';
import {Keyboard, Platform, Pressable, View, useWindowDimensions} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {AppText as Text} from './AppText';
import {ActivityLine} from './ActivityLine';
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
  // Exact identity avoids sending to an arbitrary partial-name search result.
  const recipient=suggestions.players.find(player=>player.user_id===needle||player.username?.toLocaleLowerCase()===needle.toLocaleLowerCase());
  const canSend=!!recipient&&!busy&&!suggestions.searching;
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
  async function send(){
    if(submitting.current||!canSend||!recipient)return;
    submitting.current=true;setBusy(true);setError('');
    try{await onInvite(recipient.user_id);Keyboard.dismiss();}
    catch(failure){setError(playerError(failure));}
    finally{submitting.current=false;setBusy(false);}
  }
  const width=Math.min(228,Math.max(0,(frame?.width??window.width)-insets.left-insets.right-16));
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
      <View testID="seat-invite-popover" accessibilityViewIsModal onLayout={event=>setHeight(event.nativeEvent.layout.height)} style={{position:'absolute',left,top,width,padding:10,gap:8,borderRadius:radii.medium,backgroundColor:c.surface,borderWidth:1,borderColor:c.accent,boxShadow:'0px 4px 18px rgba(0,0,0,0.28)',opacity:anchor?1:0}}>
        <FormInput testID="seat-invite-input" accessibilityLabel={ui('rooms.find_player_to_invite')} placeholder={ui('rooms.username_or_user_id')} placeholderTextColor={c.textMuted} value={query} onChangeText={value=>{setQuery(value);setError('');}} editable={!busy} maxLength={64} autoCapitalize="none" autoCorrect={false} returnKeyType="send" onSubmitEditing={()=>void send()} style={{minHeight:44,padding:10,borderWidth:1,borderColor:c.border,borderRadius:8,color:c.text,fontFamily:fonts.body,fontSize:14}}/>
        <Pressable testID="seat-invite-send" accessibilityRole="button" accessibilityLabel={ui('rooms.send_invitation')} accessibilityState={{disabled:!canSend}} disabled={!canSend} onPress={()=>void send()} style={{minHeight:44,padding:8,borderRadius:8,backgroundColor:c.primary,justifyContent:'center',alignItems:'center',opacity:canSend?1:.55}}>
          <Text style={{color:c.onPrimary,fontFamily:fonts.medium,fontSize:14}}>{ui('rooms.send_invitation')}</Text>
        </Pressable>
        {(busy||suggestions.searching)&&<ActivityLine/>}
        {error===ui('feedback.community_rules_required')&&<CommunityRulesEntry session={session} onAccepted={()=>setError('')}/>}
        {!!(error||suggestions.error)&&<Text accessibilityRole="alert" style={{fontSize:12,color:c.danger}}>{error||suggestions.error}</Text>}
        {!busy&&!suggestions.searching&&!recipient&&needle.length>=3&&!error&&!suggestions.error&&<Text style={{fontSize:12,color:c.textMuted}}>{ui('rooms.no_matching_players')}</Text>}
      </View>
    </View></KeyboardFrame>
  </GameModal>;
}
