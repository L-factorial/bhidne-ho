import { useTableFitScale } from './FittedGameTable';
import {createContext, useContext, useEffect, useRef, useState, type ReactNode} from 'react';
import {Animated, PanResponder, Pressable, View} from 'react-native';
import {AppText as Text} from './AppText';
import {SeatInvitePopover} from './SeatInvitePopover';
import {useTheme} from '../theme';
import {ui} from '../i18n/copy';
import type {RoomSnapshot} from '../screens/LiveGameTable';
import type {Session} from '../multiplayer/session';

type Seats = NonNullable<RoomSnapshot['table']>['seated_players'];
type Arrangement = {
  snapshot: RoomSnapshot; enabled: boolean; busy: boolean;
  selected: string|null; select: (user: string)=>void; invite:(position:number)=>void;
  move:(user:string,position:number,expected?:Seats)=>void;
  nodes: Map<number,View>; drop:(user:string,x:number,y:number,expected?:Seats)=>void;
};
const Context=createContext<Arrangement|null>(null);
export const useSeatArrangement=()=>useContext(Context);
export function SeatArrangementProvider({snapshot,session,busy,act,children}:{snapshot:RoomSnapshot;session:Session;busy:boolean;act:(command:string,payload?:object)=>Promise<unknown>;children:ReactNode}) {
  const [invite,setInvite]=useState<number|null>(null),[selected,setSelected]=useState<string|null>(null);
  const nodes=useRef(new Map<number,View>()).current;
  const locked=useRef(false);
  const selectedSeats=useRef<Seats|null>(null);
  const {colors}=useTheme();
  const configKey=JSON.stringify([snapshot.rule_proposal?.id,snapshot.rule_proposal?.status,snapshot.flush_settings?.rules_revision]);
  const config=useRef({match:snapshot.match_id,key:configKey});
  const [configNotice,setConfigNotice]=useState<'config_updated'|'rules_proposed'|null>(null);
  useEffect(()=>{
    const previous=config.current;
    config.current={match:snapshot.match_id,key:configKey};
    if(previous.match!==snapshot.match_id){setConfigNotice(null);return;}
    if(previous.key===configKey)return;
    const status=snapshot.rule_proposal?.status;
    setConfigNotice(status==='PENDING'?'rules_proposed':status==='ACCEPTED'?'config_updated':null);
    const timer=setTimeout(()=>setConfigNotice(null),6000);
    return()=>clearTimeout(timer);
  },[snapshot.match_id,configKey]);
  const enabled=!!snapshot.is_creator && snapshot.status!=='ended' && (snapshot.status==='waiting'||snapshot.status==='finished'||snapshot.flush?.public.status==='finished');
  useEffect(()=>{setInvite(null);setSelected(null);},[snapshot.match_id]);
  useEffect(()=>{if(!enabled){setInvite(null);setSelected(null);}},[enabled]);
  useEffect(()=>{if(invite!==null&&snapshot.table?.seated_players.some(p=>(p.position_id??p.seat_id)===invite))setInvite(null);},[invite,snapshot.table?.seated_players]);
  const move=(user:string,position:number,expected?:Seats)=>{
    if(!enabled||busy||locked.current)return;
    const seats=expected ?? (selected===user ? selectedSeats.current : null) ?? snapshot.table?.seated_players;
    const source=seats?.find(p=>p.user_id===user);
    const target=seats?.find(p=>(p.position_id??p.seat_id)===position);
    locked.current=true;setSelected(null);
    void act('move-player',{user_id:user,position_id:position,source_position:source?.position_id??source?.seat_id,target_user:target?.user_id??null}).finally(()=>{locked.current=false;});
  };
  const value:Arrangement={snapshot,enabled,busy,selected,select:user=>{selectedSeats.current=snapshot.table?.seated_players??null;setSelected(current=>current===user?null:user);},invite:position=>selected?move(selected,position):setInvite(position),move,nodes,drop:(user,x,y,expected)=>{
    for(const [position,node] of nodes)node.measureInWindow((left,top,width,height)=>{if(x>=left&&x<=left+width&&y>=top&&y<=top+height)move(user,position,expected);});
  }};
  return <Context.Provider value={value}>{configNotice&&<View testID="game-config-notice" pointerEvents="none" style={{backgroundColor:colors.tableHeader,padding:12,borderRadius:10,borderWidth:1,borderColor:colors.accent,position:'absolute',top:4,left:16,right:16,zIndex:150}}><Text accessibilityLiveRegion="polite" style={{textAlign:'center'}}>{ui(configNotice==='rules_proposed'?'common.rules_proposed':'common.config_updated')}</Text></View>}{children}
    {enabled&&invite!==null&&<SeatInvitePopover key={`${snapshot.match_id}:${invite}`} session={session} position={invite} nodes={nodes} onClose={()=>setInvite(null)}
      onInvite={async recipient=>{if(busy||locked.current)throw Error(ui('feedback.could_not_update_game'));locked.current=true;try{const result=await act('invite-position',{position_id:invite,recipient});if(result!==true)throw Error(ui('feedback.could_not_update_game'));setInvite(null);}finally{locked.current=false;}}}/>}
  </Context.Provider>;
}

export function ArrangementSeat({position,userId,children,interactive=true,onHeight}:{onHeight?:(height:number)=>void;interactive?:boolean;position:number;userId?:string;children:ReactNode}) {
  const arrangement=useSeatArrangement();
  const fit=useTableFitScale();
  const live=useRef(arrangement);live.current=arrangement;
  const delta=useRef(new Animated.ValueXY()).current;
  const [dragging,setDragging]=useState(false);
  const gesture=useRef({userId,interactive,fit});gesture.current={userId,interactive,fit};
  const registered=useRef<View|null>(null);
  const origin=useRef<{user:string;seats?:Seats}|null>(null);
  const responder=useRef(PanResponder.create({
    onMoveShouldSetPanResponderCapture:(_event,g)=>gesture.current.interactive&&!!live.current?.enabled&&!live.current.busy&&!!gesture.current.userId&&(Math.abs(g.dx)>8||Math.abs(g.dy)>8),
    onPanResponderGrant:()=>{setDragging(true);origin.current=gesture.current.userId ? {user:gesture.current.userId,seats:live.current?.snapshot.table?.seated_players} : null;},
    onPanResponderMove:(_event,g)=>delta.setValue({x:g.dx/gesture.current.fit,y:g.dy/gesture.current.fit}),
    onPanResponderRelease:event=>{setDragging(false);delta.setValue({x:0,y:0});if(origin.current)live.current?.drop(origin.current.user,event.nativeEvent.pageX,event.nativeEvent.pageY,origin.current.seats);origin.current=null;},
    onPanResponderTerminate:()=>{setDragging(false);delta.setValue({x:0,y:0});origin.current=null;},
  })).current;
  const {colors}=useTheme();
  const enabled=arrangement?.enabled && interactive;
  return <View onLayout={event=>onHeight?.(event.nativeEvent.layout.height)} {...(enabled?responder.panHandlers:{})} ref={node=>{if(registered.current&&arrangement?.nodes.get(position)===registered.current)arrangement.nodes.delete(position);registered.current=null;if(node&&enabled){registered.current=node as unknown as View;arrangement?.nodes.set(position,registered.current);}}}
    style={{width:'100%',minHeight:72,zIndex:dragging?20:enabled?5:undefined}}><Animated.View style={{width:'100%',minHeight:72,transform:delta.getTranslateTransform()}}>
    {children}
    {enabled&&userId&&<Pressable testID={`move-seat-${position}`} accessibilityRole="button" accessibilityLabel={ui('rooms.move_player')} disabled={arrangement.busy} onPress={()=>arrangement.selected&&arrangement.selected!==userId?arrangement.move(arrangement.selected,position):arrangement.select(userId)} style={{position:'absolute',inset:0,borderWidth:arrangement.selected===userId?2:0,borderColor:colors.accent,borderRadius:8}}/>}
    {enabled&&!userId&&<Pressable testID={`invite-seat-${position}`} accessibilityRole="button" accessibilityLabel={ui('rooms.invite_players')} disabled={arrangement.busy} onPress={()=>arrangement.invite(position)} style={{position:'absolute',inset:0}}/>}
    {enabled&&!userId&&arrangement.snapshot.table?.reserved_positions?.some(p=>p.position_id===position)&&<Text pointerEvents="none" style={{color:colors.accent,fontSize:10,textAlign:'center'}}>{ui('rooms.reserved_seat')}</Text>}
  </Animated.View></View>;
}
export function ArrangementHint(){
  const arrangement=useSeatArrangement(),{colors}=useTheme();
  const opacity=useRef(new Animated.Value(1)).current;
  useEffect(()=>{opacity.setValue(1);const animation=Animated.timing(opacity,{toValue:.35,duration:5000,useNativeDriver:true});animation.start();return()=>animation.stop();},[arrangement?.snapshot.match_id,arrangement?.enabled]);
  return arrangement?.enabled?<Animated.View pointerEvents="none" style={{opacity,maxWidth:180,alignSelf:'center',marginTop:8}}><Text style={{color:colors.textMuted,fontSize:11,textAlign:'center'}}>{ui(arrangement.selected?'rooms.select_move':'rooms.seat_hint')}</Text></Animated.View>:null;
}
