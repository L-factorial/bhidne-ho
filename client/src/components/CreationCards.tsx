import {useEffect,useState} from 'react';
import {ActivityIndicator,View} from 'react-native';
import {AppText as Text} from './AppText';
import {useTheme,fonts,radii} from '../theme';
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
export function CreationCards({runtime,kind,roomId,matches=[]}:{runtime?:OriginalDistributedRuntime|null;kind:'room'|'table';roomId?:string;matches?:string[]}){
  useUiLanguage();const {colors}=useTheme();const {cards,feedback}=useCreationProgress(runtime);
  return <View style={{gap:10}}>
    {cards.filter(card=>card.kind===kind&&(!roomId||card.roomId===roomId)&&(!card.matchId||!matches.includes(card.matchId))).map(card=><View key={card.id} testID={`creating-${kind}`} accessibilityLiveRegion="polite" style={{padding:20,gap:10,borderRadius:radii.medium,borderWidth:1,borderColor:colors.border,backgroundColor:colors.surface}}>
      <Text style={{color:colors.text,fontFamily:fonts.medium,fontSize:20}}>{card.name}</Text>
      <View style={{flexDirection:'row',alignItems:'center',gap:10}}><ActivityIndicator color={colors.accent}/><Text style={{color:colors.textMuted}}>{ui(kind==='room'||card.stage==='room'?'rooms.creating_room':'rooms.creating_table')}</Text></View>
    </View>)}
    {feedback.filter(item=>item.kind===kind&&(!roomId||item.roomId===roomId)).map(item=><Text key={item.id} accessibilityRole={item.error?'alert':undefined} accessibilityLiveRegion="polite" style={{color:item.error?colors.danger:colors.textMuted,padding:12}}>{item.error?playerError(item.error):ui('rooms.busy_invitees_skipped',{players:item.skipped?.join(', ')??''})}</Text>)}
  </View>;
}
