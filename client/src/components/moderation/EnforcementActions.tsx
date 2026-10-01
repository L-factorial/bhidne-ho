import { useRef, useState } from 'react';
import { View } from 'react-native';
import { sharedRequest } from '../../multiplayer/api';
import type { Session } from '../../multiplayer/session';
import { Button, Copy, copy } from './Controls';
import { FormInput } from '../FormInput';
import { RoomSheet } from '../RoomSheet';
import { useTheme } from '../../theme';
// Non-secret idempotency key; native fallback does not supply authentication.
const newId=()=>globalThis.crypto?.randomUUID?.()??'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,c=>{const r=Math.floor(Math.random()*16);return(c==='x'?r:(r&3)|8).toString(16);});

type Action='remove_message'|'mute'|'unmute'|'suspend'|'unsuspend';
type Audit={id:string;action:Action;reason:string;created_at:string;until_at:string|null};
export function EnforcementActions({session,reportId,scope,target}:{session:Session;reportId:string;scope:string;target:string}) {
 const {colors:c}=useTheme();const [action,setAction]=useState<Action|null>(null),[reason,setReason]=useState(''),[hours,setHours]=useState(24);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[done,setDone]=useState(false),[history,setHistory]=useState<Audit[]>([]);
 const pending=useRef(false),requestId=useRef('');
 async function submit(){if(!action||pending.current)return;pending.current=true;setBusy(true);setError('');
  try{await sharedRequest(`/moderation/reports/${reportId}/actions`,session,{request_id:requestId.current,action,reason:reason.trim(),hours});setDone(true);setAction(null);}
  catch(e){setError(e instanceof Error?e.message:copy('failed'));}finally{pending.current=false;setBusy(false);}}
 async function audit(){setError('');try{const v=await sharedRequest<{items:Audit[]}>(`/moderation/users/${encodeURIComponent(target)}/actions`,session);setHistory(v.items);}catch{setError(copy('failed'));}}
 return <View style={{gap:10}}><Copy>{copy('enforcement_help')}</Copy>
  <View style={{flexDirection:'row',flexWrap:'wrap',gap:8}}>{(['remove_message','mute','unmute','suspend','unsuspend'] as Action[]).filter(a=>scope!=='player'||a!=='remove_message').map(a=><Button key={a} label={copy(a)} disabled={busy} onPress={()=>{requestId.current=newId();setAction(a);setReason('');setError('');setDone(false);}} />)}
  <Button label={copy('audit')} onPress={()=>void audit()} /></View>
  {done&&<Copy>{copy('action_done')}</Copy>}{!!error&&<Copy alert>{error}</Copy>}
  {history.map(h=><Copy key={h.id}>{copy(h.action)} · {new Date(h.created_at).toLocaleString()} · {h.reason}{h.until_at?` · ${new Date(h.until_at).toLocaleString()}`:''}</Copy>)}
  {action&&<RoomSheet visible presentation="dialog" title={copy(action)} onClose={()=>{if(!busy)setAction(null);}}>
   <Copy>{copy('enforcement_help')}</Copy>
   {(action==='mute'||action==='suspend')&&<View style={{flexDirection:'row',flexWrap:'wrap',gap:8}}>{[1,24,168,720].map(h=><Button key={h} label={copy(`duration_${h}`)} selected={hours===h} disabled={busy} onPress={()=>{setHours(h);requestId.current=newId();}} />)}</View>}
   <FormInput accessibilityLabel={copy('reason')} placeholder={copy('reason')} placeholderTextColor={c.textMuted} value={reason} onChangeText={v=>{setReason(v);requestId.current=newId();}} editable={!busy} multiline maxLength={1000} style={{color:c.text,borderColor:c.border,borderWidth:1,borderRadius:10,padding:12,minHeight:80}} />
   {!!error&&<Copy alert>{error}</Copy>}<Button label={copy('confirm_action')} disabled={busy||!reason.trim()} onPress={()=>void submit()} />
  </RoomSheet>}
 </View>;
}
