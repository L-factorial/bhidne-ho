import {useEffect, useState} from 'react';
import {Pressable, ScrollView, View} from 'react-native';
import {AppText as Text} from './AppText';
import {ui} from '../i18n/copy';
import {useUiLanguage} from '../i18n/useUiLanguage';
import {fonts, useTheme} from '../theme';
import {ownAction, remaining, sessionNow, sessionTime} from '../multiplayer/tableSession';
import type {RoomSnapshot} from '../screens/LiveGameTable';

export function GameSessionStatus({snapshot,userId,busy,act}: {
  snapshot:RoomSnapshot;userId:string;busy:boolean;act:(command:string)=>Promise<void>;
}) {
  useUiLanguage();
  const {colors}=useTheme();
  const [now,setNow]=useState(sessionNow);
  const s=snapshot.session;
  useEffect(()=>{
    if(!s)return;
    setNow(sessionNow());
    const timer=setInterval(()=>setNow(sessionNow()),1000);
    return ()=>clearInterval(timer);
  },[!!s]);
  if(!s || s.expired_at || s.removal_reason==='ACTION_TIMEOUT')return null;
  const name=(seat:number)=>snapshot.players?.find(p=>p.player_id===seat)?.display_name ?? ui('rooms.seat_seat_player',{seat,player:''}).trim();
  const own=ownAction(s,userId);
  const turn=own ?? s.required_actions.find(t=>s.controls.find(c=>c.seat_id===t.seat_id)?.mode!=='auto');
  const deadline=s.idle_deadline ?? turn?.deadline;
  const time=deadline==null ? null:sessionTime(remaining(deadline,now));
  const warning=!!own && remaining(own.deadline,now)<=30;
  const modes=s.controls.filter(c=>c.mode!=='manual' || c.disconnected_at!==null);
  const offer=s.replacement_offer;
  const button=(label:string,command:string)=><Pressable key={command} accessibilityRole="button" accessibilityLabel={label}
    disabled={busy} accessibilityState={{disabled:busy}} onPress={()=>void act(command)}
    style={{minHeight:44,padding:10,justifyContent:'center',borderWidth:1,borderColor:colors.border,borderRadius:12,opacity:busy?.5:1}}>
    <Text style={{color:colors.accent,fontFamily:fonts.medium,flexShrink:1}}>{label}</Text>
  </Pressable>;
  if(deadline==null && !modes.length && !offer && !s.reclaim)return null;
  return <ScrollView testID="game-session-status" style={{maxHeight:220,flexGrow:0,borderBottomWidth:1,borderColor:colors.border,backgroundColor:colors.surface}}
    contentContainerStyle={{paddingHorizontal:12,paddingVertical:6,gap:6}} nestedScrollEnabled>
    {time!==null && <Text testID="session-countdown" style={{color:warning?colors.danger:colors.textMuted,fontFamily:fonts.body,fontSize:12}}>
      {deadline!<=now?ui('rooms.session_waiting_server'):s.idle_deadline!=null?ui('rooms.session_idle',{time}):
        ui(warning?'rooms.session_action_warning':'rooms.session_action',{player:turn?name(turn.seat_id):'',time})}
    </Text>}
    <View style={{flexDirection:'row',flexWrap:'wrap',gap:8}}>
      {modes.map(c=><Text key={c.seat_id} style={{color:colors.textMuted,fontFamily:fonts.body,fontSize:12,flexShrink:1}}>
        {ui(c.mode==='auto'?'rooms.session_auto':c.mode==='replacement'?'rooms.session_replacement':'rooms.session_disconnected',{player:name(c.seat_id)})}
      </Text>)}
    </View>
    {!!s.reclaim && (s.reclaim.pending ? <Text accessibilityLiveRegion="polite" style={{color:colors.text}}>{ui('rooms.session_return_pending')}</Text>
      : button(ui('rooms.session_reclaim'),'reclaim-seat'))}
    {!!offer && <View testID="session-live-offer" style={{gap:6}}>
      <Text accessibilityLiveRegion="polite" style={{color:colors.text,fontFamily:fonts.medium}}>{ui('rooms.session_offer',{seat:offer.seat_id,time:sessionTime(remaining(offer.expires_at,now))})}</Text>
      <Text style={{color:colors.textMuted,fontFamily:fonts.body,fontSize:12}}>{ui('rooms.session_offer_help')}</Text>
      <View style={{flexDirection:'row',flexWrap:'wrap',gap:8}}>
        {button(ui('rooms.session_offer_accept'),'accept-live-seat')}
        {button(ui('rooms.session_offer_decline'),'decline-live-seat')}
      </View>
    </View>}
  </ScrollView>;
}
