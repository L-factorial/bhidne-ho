import {useEffect,useRef,useState} from 'react';
import {AppState,Pressable,View} from 'react-native';
import {AppText as Text} from './AppText';
import {ui} from '../i18n/copy';
import {playerError} from '../multiplayer/playerError';
import {hasCompletedSeat} from '../multiplayer/tableNavigation';
import type {PlayTable} from '../multiplayer/playFeed';
import type {CreationFeedback} from '../multiplayer/creationProgress';
import type {OriginalDistributedRuntime} from '../multiplayer/OriginalDistributedRuntime';
import {useTheme,radii} from '../theme';

export function SeatReservationNotice({runtime,item,onReturn,onReleased}:{runtime:OriginalDistributedRuntime;item:CreationFeedback;onReturn?:(table:PlayTable)=>void;onReleased?:()=>void}){
  const {colors}=useTheme();
  const [table,setTable]=useState<PlayTable|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[confirm,setConfirm]=useState(false);
  const pending=useRef(false),mounted=useRef(true);
  const releasedCallback=useRef(onReleased);releasedCallback.current=onReleased;
  const context=item.context!,room=context.room_id!,match=context.match_id!;
  useEffect(()=>{
    const controller=new AbortController();mounted.current=true;let reading=false;
    async function refresh(){
      if(reading||controller.signal.aborted||AppState.currentState==='background')return;
      reading=true;
      try{
        const view=await runtime.reservedTable(room,match,controller.signal);
        if(controller.signal.aborted)return;
        if(view.status==='ended'||view.table?.phase==='ENDED'||view.table?.current_user.is_seated===false){
          if(runtime.creationFeedback.get(item.id)===item){runtime.creationFeedback.delete(item.id);releasedCallback.current?.();}
          return;
        }
        const preview=view.tables?.find(row=>row.match_id===match);
        if(preview)setTable({...preview,room_id:room,room_name:view.room_name});
      }catch{/* A failed read is not evidence that the seat has been released. */}
      finally{reading=false;}
    }
    void refresh();const timer=setInterval(()=>void refresh(),5000);
    const activity=runtime.root.observeActivity(()=>void refresh());
    const wake=AppState.addEventListener('change',state=>{if(state==='active')void refresh();});
    return()=>{mounted.current=false;controller.abort();clearInterval(timer);activity();wake.remove();};
  },[runtime,item,room,match]);
  async function leave(){
    if(pending.current||context.departure_command==='end')return;
    if(context.departure_command==='abandon'&&!confirm){setConfirm(true);return;}
    pending.current=true;setBusy(true);setError('');
    try{
      await runtime.leaveReservedTable(room,match,context.departure_command==='abandon');
      if(runtime.creationFeedback.get(item.id)===item){runtime.creationFeedback.delete(item.id);releasedCallback.current?.();}
    }catch(failure){if(mounted.current)setError(playerError(failure));}
    finally{pending.current=false;if(mounted.current)setBusy(false);}
  }
  const button={minHeight:44,paddingHorizontal:12,justifyContent:'center' as const,borderRadius:radii.medium,borderWidth:1,borderColor:colors.border,opacity:busy?0.5:1};
  return <View testID="seat-reservation-notice" style={{padding:16,gap:10,borderRadius:radii.medium,borderWidth:1,borderColor:colors.border,backgroundColor:colors.surface}}>
    <Text accessibilityRole="alert" style={{color:colors.danger}}>{playerError(item.error||'')}</Text>
    {table&&<Text style={{color:colors.text}}>{table.room_name} → {table.name}</Text>}
    {table&&hasCompletedSeat(table)&&<Text style={{color:colors.accent}}>{ui('rooms.completed_seat_reserved')}</Text>}
    {confirm&&<Text style={{color:colors.danger}}>{ui('rooms.abandon_effect')}</Text>}
    {!!error&&<Text accessibilityRole="alert" style={{color:colors.danger}}>{error}</Text>}
    <View style={{flexDirection:'row',flexWrap:'wrap',gap:8}}>
      {onReturn&&<Pressable accessibilityRole="button" disabled={busy||!table} onPress={()=>{if(table)onReturn(table);}} style={button}><Text style={{color:colors.accent}}>{ui('common.return_to_table')}</Text></Pressable>}
      {context.departure_command!=='end'&&<Pressable accessibilityRole="button" disabled={busy||!table} onPress={()=>void leave()} style={button}><Text style={{color:colors.text}}>{ui(context.departure_command==='abandon'?'rooms.abandon_previous_game':'rooms.leave_table')}</Text></Pressable>}
      {confirm&&<Pressable accessibilityRole="button" disabled={busy} onPress={()=>setConfirm(false)} style={button}><Text style={{color:colors.text}}>{ui('common.cancel')}</Text></Pressable>}
    </View>
  </View>;
}
