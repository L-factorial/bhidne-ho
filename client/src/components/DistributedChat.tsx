import {useEffect,useState} from 'react';
import {Pressable,Text,TextInput,View} from 'react-native';
import type {DistributedRootRuntime} from '../multiplayer/DistributedRoot';
import type {SelectedTable} from '../multiplayer/DistributedControls';
import type {CommandTarget} from '../multiplayer/DurableCommandClient';
import {useDistributedController} from '../multiplayer/useDistributedController';
import {useTheme} from '../theme';
export function DistributedChat({root,view}:{root:DistributedRootRuntime;view:SelectedTable}) {
  const {colors}=useTheme();
  const [scope,setScope]=useState<'room_chat'|'table_chat'|'game_chat'>('table_chat');
  const [text,setText]=useState(''),[items,setItems]=useState<{id:string;text:string;sender_id:string}[]>([]),[error,setError]=useState('');
  const {controller,state,version}=useDistributedController(root,'scoped-chat');
  const target:CommandTarget={kind:scope,room_id:view.room_id};
  if(scope!=='room_chat')target.table_id=view.table_id;
  if(scope==='game_chat'&&view.durable_game_id)target.game_id=view.durable_game_id;
  const identity=JSON.stringify(target);
  useEffect(()=>{
    const abort=new AbortController();let timer:ReturnType<typeof setTimeout>;setItems([]);
    async function load(){
      try{
        if(scope==='game_chat'&&!view.durable_game_id)throw Error('No active game is selected.');
        const stream=await root.reads.open(JSON.parse(identity),abort.signal);
        const rows=await root.reads.history('chat',stream.lane_id,abort.signal);
        if(!abort.signal.aborted){setItems(rows.map(r=>({id:r.id,text:String(r.text),sender_id:String(r.sender_id)})));setError('');}
      }catch(e){if(!abort.signal.aborted){setItems([]);setError(e instanceof Error?e.message:'Chat unavailable.');}}
      finally{if(!abort.signal.aborted)timer=setTimeout(load,5000);}
    }
    void load();return()=>{abort.abort();clearTimeout(timer);};
  },[root,identity,version]);
  return <View style={{padding:12,gap:8}}>
    <View style={{flexDirection:'row'}}>{(['room_chat','table_chat','game_chat'] as const).map(kind=><Pressable key={kind} accessibilityRole="button"
      disabled={kind==='game_chat'&&!view.durable_game_id} onPress={()=>setScope(kind)} style={{padding:10}}><Text style={{color:colors.text}}>{kind.replace('_chat','')}{scope===kind?' ✓':''}</Text></Pressable>)}</View>
    {items.map(item=><Text key={item.id} style={{color:colors.text}}>{item.sender_id}: {item.text}</Text>)}
    <TextInput accessibilityLabel="Chat message" value={text} onChangeText={setText} maxLength={500} style={{color:colors.text,borderWidth:1,borderColor:colors.textMuted,padding:10}}/>
    <Pressable accessibilityRole="button" disabled={!controller||state.busy||!text.trim()||(scope==='game_chat'&&!view.durable_game_id)} onPress={()=>{
      const sent=text;void controller?.chat(target,sent).then(ok=>{if(ok&&controller.state.status==='accepted')setText(current=>current===sent?'':current);});
    }} style={{padding:12}}><Text style={{color:colors.accent}}>Send chat</Text></Pressable>
    {state.status==='pending'&&<Pressable accessibilityRole="button" onPress={()=>void controller?.recover()}><Text style={{color:colors.accent}}>Check pending message</Text></Pressable>}
    {!!(error||state.error)&&<Text accessibilityRole="alert" style={{color:colors.danger}}>{state.error||error}</Text>}
  </View>;
}
