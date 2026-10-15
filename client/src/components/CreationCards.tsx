import {ActivityLine} from './ActivityLine';
import {SeatReservationNotice} from './SeatReservationNotice';
import type {PlayTable} from '../multiplayer/playFeed';
import {useEffect,useState} from 'react';
import {View} from 'react-native';
import {AppText as Text} from './AppText';
import {useTheme} from '../theme';
import {ui} from '../i18n/copy';
import {useUiLanguage} from '../i18n/useUiLanguage';
import {playerError} from '../multiplayer/playerError';
import {creationProgress} from '../multiplayer/creationProgress';
import type {CreationFeedback,CreationProgress} from '../multiplayer/creationProgress';
import type {OriginalDistributedRuntime} from '../multiplayer/OriginalDistributedRuntime';
export function useCreationProgress(runtime?:OriginalDistributedRuntime|null){
  const [state,setState]=useState<{cards:CreationProgress[];feedback:CreationFeedback[]}>({cards:[],feedback:[]});
  useEffect(()=>{
    if(!runtime){setState({cards:[],feedback:[]});return;}
    const read=()=>{
      const cards=['original-room-actions','ui-table-control'].flatMap(slot=>{
        const command=runtime.root.session.command(slot),card=creationProgress(command.request,command.latest);
        return card?[card]:[];
      });
      const flow=runtime.creationFlow;
      if(flow&&!cards.some(card=>card.kind==='table'))cards.push({id:flow.id,kind:'table',roomId:flow.room?.room_id,name:flow.room?'Table':flow.defaultName,stage:flow.room?'table':'room',gameType:String(flow.payload.game_type)});
      setState({cards,feedback:[...runtime.creationFeedback.values()].filter(item=>!cards.some(card=>card.kind===item.kind))});
    };
    read();const timer=setInterval(read,250);return()=>clearInterval(timer);
  },[runtime]);
  return state;
}
export function CreationCards({runtime,kind,roomId,matches=[],onReturn,onReleased}:{runtime?:OriginalDistributedRuntime|null;kind:'room'|'table';roomId?:string;matches?:string[];onReturn?:(table:PlayTable)=>void;onReleased?:()=>void}){
  useUiLanguage();const {colors}=useTheme();const {feedback}=useCreationProgress(runtime);
  const notices=feedback.filter(item=>item.kind===kind&&(!roomId||item.roomId===roomId));
  if(!notices.length)return null;
  return <View style={{gap:10}}>
    {notices.map(item=>runtime&&item.context?.code==='PLAYER_ALREADY_AT_TABLE'&&item.context.room_id&&item.context.match_id?<SeatReservationNotice key={item.id} runtime={runtime} item={item} onReturn={onReturn} onReleased={onReleased}/>:<Text key={item.id} accessibilityRole={item.error?'alert':undefined} accessibilityLiveRegion="polite" style={{color:item.error?colors.danger:colors.textMuted,padding:12}}>{item.error?playerError(item.error):ui('rooms.busy_invitees_skipped',{players:item.skipped?.join(', ')??''})}</Text>)}
  </View>;
}

/** Progress is separate from the table catalog and never intercepts navigation. */
export function CreationActivity({active}:{active:boolean}){
  return <View testID="creation-bottom-activity" pointerEvents="none" style={{height:3,flexShrink:0,opacity:.6}}>
    <ActivityLine active={active}/>
  </View>;
}
