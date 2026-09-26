import {useEffect,useState} from 'react';
import {Pressable,Text,View} from 'react-native';
import {request} from '../multiplayer/api';
import type {Session} from '../multiplayer/session';
import type {DistributedRootRuntime} from '../multiplayer/DistributedRoot';
import {useDistributedController} from '../multiplayer/useDistributedController';
import {useTheme} from '../theme';
export function DistributedRoomSettings({root,room,session}:{root:DistributedRootRuntime;room:string;session:Session}) {
  const {colors}=useTheme();
  const {controller,state}=useDistributedController(root,'room-settings');
  const [friends,setFriends]=useState<{user_id:string;display_name:string}[]>([]),[error,setError]=useState(''),[confirm,setConfirm]=useState(false);
  useEffect(()=>{const abort=new AbortController();void request<{friends:typeof friends}>('/friends',session,undefined,abort.signal).then(value=>{if(!abort.signal.aborted)setFriends(value.friends);}).catch(e=>{if(!abort.signal.aborted)setError(String(e));});return()=>abort.abort();},[session]);
  const button=(label:string,run:()=>void)=><Pressable accessibilityRole="button" disabled={!controller||state.busy} onPress={run} style={{padding:12}}><Text style={{color:colors.accent}}>{label}</Text></Pressable>;
  return <View style={{gap:8}}>
    <Text style={{color:colors.text}}>Room settings</Text>
    {button('Make room public',()=>void controller?.room(room,'room-visibility',{visibility:'public'}))}
    {button('Make room private',()=>void controller?.room(room,'room-visibility',{visibility:'private'}))}
    {friends.map(friend=><View key={friend.user_id}>{button('Invite '+friend.display_name,()=>void controller?.room(room,'invite-room',{recipients:[friend.user_id]}))}</View>)}
    {confirm?button('Confirm delete room',()=>void controller?.room(room,'delete-room')):button('Delete room',()=>setConfirm(true))}
    {state.status==='pending'&&button('Check pending action',()=>void controller?.recover())}
    {!!(error||state.error)&&<Text accessibilityRole="alert" style={{color:colors.danger}}>{state.error||error}</Text>}
  </View>;
}
