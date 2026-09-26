import {useEffect,useState} from 'react';
import {Pressable,Text,View} from 'react-native';
import {request} from '../multiplayer/api';
import type {Session} from '../multiplayer/session';
import {useTheme} from '../theme';
export function DistributedInvitees({session,selected,change}:{session:Session;selected:string[];change:(users:string[])=>void}) {
  const {colors}=useTheme();
  const [friends,setFriends]=useState<{user_id:string;display_name:string;username?:string}[]>([]),[error,setError]=useState('');
  useEffect(()=>{const abort=new AbortController();void request<{friends:typeof friends}>('/friends',session,undefined,abort.signal)
    .then(value=>{if(!abort.signal.aborted)setFriends(value.friends);}).catch(e=>{if(!abort.signal.aborted)setError(String(e));});return()=>abort.abort();},[session]);
  return <View>{friends.map(friend=>{
    const checked=selected.includes(friend.user_id);
    return <Pressable key={friend.user_id} accessibilityRole="checkbox" accessibilityState={{checked}}
      disabled={!checked&&selected.length>=20} onPress={()=>change(checked?selected.filter(id=>id!==friend.user_id):[...selected,friend.user_id])} style={{padding:12}}>
      <Text style={{color:colors.text}}>{checked?'✓ ':''}{friend.display_name||friend.username||'Player'}</Text></Pressable>;
  })}{!friends.length&&<Text style={{color:colors.text}}>Add friends from your profile to invite them.</Text>}
  {!!error&&<Text accessibilityRole="alert" style={{color:colors.danger}}>{error}</Text>}</View>;
}
