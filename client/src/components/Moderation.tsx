import {AppText as Text} from './AppText';
import { ContextMenu, MenuAction } from './ContextMenu';
import type { ReactNode } from 'react';
import { Button, Copy, copy } from './moderation/Controls';
import { EnforcementActions } from './moderation/EnforcementActions';
import { useEffect, useRef, useState } from 'react';
import {Modal, Pressable, View} from 'react-native';
import { sharedRequest, ApiError } from '../multiplayer/api';
import type { Session } from '../multiplayer/session';
import { ui } from '../i18n/copy';
import type { UiKey } from '../i18n/catalogs';
import { useUiLanguage } from '../i18n/useUiLanguage';
import { radii, fonts, useTheme } from '../theme';
import { AppHeader } from './AppHeader';
import { FormInput, FormScrollView } from './FormInput';
import { KeyboardFrame } from './KeyboardFrame';
import { RoomSheet } from './RoomSheet';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const categories = ['harassment','hate','sexual','spam','other'] as const;

function failure(error: unknown) {
  return copy(error instanceof ApiError ? error.status === 403 ? 'denied' : error.status === 429 ? 'limited' : error.status === 409 ? 'conflict' : 'failed' : 'failed');
}
export function ReportButton({session,player,enabled,scope='player',messageId,renderTrigger}: {
  session:Session;player:{user_id:string;display_name:string};enabled:boolean;scope?:'player'|'direct'|'chat';messageId?:string;renderTrigger?:(open:()=>void)=>ReactNode;
}) {
  useUiLanguage();const {colors:c}=useTheme();
  const [open,setOpen]=useState(false),[busy,setBusy]=useState(false),[done,setDone]=useState(false),[error,setError]=useState('');
  const [category,setCategory]=useState<typeof categories[number]>('harassment'),[explanation,setExplanation]=useState('');
  const pending=useRef(false);
  async function submit() {
    if(pending.current)return;pending.current=true;setBusy(true);setError('');
    try {await sharedRequest('/me/reports',session,{reported_user_id:player.user_id,scope,message_id:messageId||null,category,explanation});setDone(true);}
    catch(e){setError(failure(e));}finally{pending.current=false;setBusy(false);}
  }
  const allowed=enabled && player.user_id!==session.user_id;
  const launch=()=>{setOpen(true);setDone(false);setError('');};
  if(!allowed)return renderTrigger ? <>{renderTrigger(()=>{})}</> : null;
  return <>
    {renderTrigger ? renderTrigger(launch) : scope==='player' ? <Button label={copy('report_player')} onPress={launch} /> : <ContextMenu label={ui('common.message_actions')}>{close=><MenuAction label={`🚩 ${copy('report_message')}`} onPress={()=>{close();launch();}} />}</ContextMenu>}
    {open&&<RoomSheet visible presentation="dialog" title={copy(scope==='player'?'report_player':'report_message')} onClose={()=>{if(!busy)setOpen(false);}}>
      <Copy>{player.display_name}</Copy>
      {done?<><Copy>{copy('submitted')}</Copy><Button label={copy('close')} onPress={()=>setOpen(false)} /></>:<>
        <Copy>{copy('private')}</Copy>
        <View style={{flexDirection:'row',flexWrap:'wrap',gap:8}}>{categories.map(value=><Button key={value} label={copy(value)} selected={category===value} disabled={busy} onPress={()=>setCategory(value)} />)}</View>
        <FormInput accessibilityLabel={copy('explanation')} placeholder={copy('explanation')} placeholderTextColor={c.textMuted} value={explanation} onChangeText={setExplanation}
          multiline maxLength={1000} editable={!busy} style={{color:c.text,borderWidth:1,borderColor:c.border,borderRadius: radii.medium,padding:12,minHeight:80}} />
        {!!error&&<Copy alert>{error}</Copy>}
        <Button label={copy('submit')} disabled={busy} onPress={()=>void submit()} />
      </>}
    </RoomSheet>}
  </>;
}

type Group={user_id:string;display_name:string;username:string|null;count:number;latest:string};
type Report={id:string;scope:string;category:string;explanation:string;evidence:{text?:string;display_name:string;username:string|null;sent_at?:string;context?:string};created_at:string;decision:string|null;reason:string|null;moderator_id:string|null;decided_at:string|null};
type Page<T>={items:T[];next_id:string|null};
function ReportGroup({group,session,reviewed,onDecision,onDenied}: {group:Group;session:Session;reviewed:boolean;onDecision:()=>void;onDenied:()=>void}) {
  const {colors:c}=useTheme();
  const [open,setOpen]=useState(false),[page,setPage]=useState<Page<Report>>({items:[],next_id:null}),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [decision,setDecision]=useState<{report:Report;value:'accepted'|'declined'}|null>(null),[reason,setReason]=useState('');
  const [reload,setReload]=useState(0);const lifetime=useRef<AbortController|null>(null);const pending=useRef(false);
  const path=`/moderation/users/${encodeURIComponent(group.user_id)}/reports?reviewed=${reviewed}`;
  useEffect(()=>{
    if(!open)return;
    const controller=new AbortController();lifetime.current=controller;setBusy(true);setError('');setPage({items:[],next_id:null});
    void sharedRequest<Page<Report>>(path,session,undefined,controller.signal).then(v=>{if(!controller.signal.aborted)setPage(v);})
      .catch(e=>{if(!controller.signal.aborted){setError(failure(e));if(e instanceof ApiError&&e.status===403)onDenied();}})
      .finally(()=>{if(!controller.signal.aborted)setBusy(false);});
    return()=>controller.abort();
  },[open,reviewed,session.token,group.user_id,reload]);
  async function more(){
    if(busy||!page.next_id)return;setBusy(true);const signal=lifetime.current?.signal;
    try{const v=await sharedRequest<Page<Report>>(path+`&after=${page.next_id}`,session,undefined,signal);if(!signal?.aborted)setPage(p=>({items:[...p.items,...v.items],next_id:v.next_id}));}
    catch(e){if(!signal?.aborted){setError(failure(e));if(e instanceof ApiError&&e.status===403)onDenied();}}finally{if(!signal?.aborted)setBusy(false);}
  }
  async function confirm(){
    if(!decision||!reason.trim()||pending.current)return;pending.current=true;setBusy(true);setError('');const signal=lifetime.current?.signal;
    try{await sharedRequest(`/moderation/reports/${decision.report.id}/decision`,session,{decision:decision.value,reason:reason.trim()},signal);if(!signal?.aborted){setDecision(null);onDecision();}}
    catch(e){if(!signal?.aborted){setError(failure(e));if(e instanceof ApiError&&e.status===403)onDenied();}}
    finally{pending.current=false;if(!signal?.aborted)setBusy(false);}
  }
  return <View style={{borderWidth:1,borderColor:c.border,borderRadius: radii.medium,padding:12,gap:10}}>
    <Pressable accessibilityRole="button" accessibilityState={{expanded:open}} accessibilityLabel={`${copy('reports_for')} ${group.username||group.display_name||group.user_id}`} onPress={()=>setOpen(v=>!v)} style={{minHeight:44,gap:4}}>
      <Text style={{color:c.text,fontFamily:fonts.medium,fontSize:16}}>{open?'▾':'▸'} {group.display_name||group.username||group.user_id}</Text>
      {!!group.username&&<Copy>@{group.username}</Copy>}
      <Copy>{group.user_id}</Copy><Copy>{group.count} · {copy(reviewed?'reviewed':'pending')} · {new Date(group.latest).toLocaleString()}</Copy>
    </Pressable>
    {open&&<>
      {!!error&&<><Copy alert>{error}</Copy><Button label={copy('refresh')} disabled={busy} onPress={()=>setReload(v=>v+1)} /></>}
      {busy&&<Copy>{copy('loading')}</Copy>}
      {!busy&&!error&&!page.items.length&&<Copy>{copy('empty')}</Copy>}
      {page.items.map(report=><View key={report.id} style={{borderTopWidth:1,borderColor:c.borderSubtle,paddingTop:12,gap:10}}>
        <Text style={{color:c.accent,fontFamily:fonts.medium}}>{copy(report.category)} · {copy(report.scope==='player'?'report_player':'report_message')}</Text>
        <Copy>{new Date(report.created_at).toLocaleString()}</Copy>
        {report.scope==='player'&&<View style={{padding:12,borderRadius: radii.medium,backgroundColor:c.surfaceRaised}}>
          <Copy>{copy('profile_evidence')}</Copy><Copy>{report.evidence.display_name}</Copy>
          {!!report.evidence.username&&<Copy>@{report.evidence.username}</Copy>}
        </View>}
        {report.evidence.text&&<View style={{padding:12,borderRadius: radii.medium,backgroundColor:c.surfaceRaised}}><Copy>{copy('message_evidence')}</Copy><Copy>{report.evidence.text}</Copy></View>}
        {!!report.explanation&&<View><Copy>{copy('reporter_details')}</Copy><Copy>{report.explanation}</Copy></View>}
        {report.decision==='accepted'&&<EnforcementActions session={session} reportId={report.id} scope={report.scope} target={group.user_id} />}
        {report.decision?<><Copy>{copy(report.decision)}</Copy><Copy>{report.reason}</Copy><Copy>{report.moderator_id} · {report.decided_at&&new Date(report.decided_at).toLocaleString()}</Copy></>:
          <View style={{flexDirection:'row',flexWrap:'wrap',gap:8}}>{(['accepted','declined'] as const).map(value=><Button key={value} label={copy(value==='accepted'?'accept':'decline')} disabled={busy} onPress={()=>{setDecision({report,value});setReason('');setError('');}} />)}</View>}
      </View>)}
      {!!page.next_id&&<Button label={copy('more')} disabled={busy} onPress={()=>void more()} />}
    </>}
    {decision&&<RoomSheet visible presentation="dialog" title={copy(decision.value==='accepted'?'accept':'decline')} onClose={()=>{if(!busy)setDecision(null);}}>
      <Copy>{copy('decision_help')}</Copy>
      <FormInput accessibilityLabel={copy('reason')} placeholder={copy('reason')} placeholderTextColor={c.textMuted} value={reason} onChangeText={setReason} multiline maxLength={1000} editable={!busy}
        style={{color:c.text,borderWidth:1,borderColor:c.border,borderRadius: radii.medium,padding:12,minHeight:90}} />
      {!!error&&<Copy alert>{error}</Copy>}
      <Button label={copy('confirm')} disabled={busy||!reason.trim()} onPress={()=>void confirm()} />
    </RoomSheet>}
  </View>;
}
function ModerationPage({session,onBack}: {session:Session;onBack:()=>void}) {
  useUiLanguage();const {colors:c}=useTheme();const insets=useSafeAreaInsets();
  const [reviewed,setReviewed]=useState(false),[page,setPage]=useState<Page<Group>>({items:[],next_id:null});
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[revision,setRevision]=useState(0),[denied,setDenied]=useState(false);
  const lifetime=useRef<AbortController|null>(null);
  const deny=()=>{setDenied(true);setPage({items:[],next_id:null});setError(copy('denied'));};
  useEffect(()=>{
    const controller=new AbortController();lifetime.current=controller;setBusy(true);setError('');setPage({items:[],next_id:null});setDenied(false);
    void sharedRequest<Page<Group>>(`/moderation/users?reviewed=${reviewed}`,session,undefined,controller.signal)
      .then(v=>{if(!controller.signal.aborted)setPage(v);}).catch(e=>{if(!controller.signal.aborted){setError(failure(e));if(e instanceof ApiError&&e.status===403)deny();}})
      .finally(()=>{if(!controller.signal.aborted)setBusy(false);});return()=>controller.abort();
  },[session.token,reviewed,revision]);
  async function more(){
    if(busy||!page.next_id)return;setBusy(true);const signal=lifetime.current?.signal;
    try{const v=await sharedRequest<Page<Group>>(`/moderation/users?reviewed=${reviewed}&after=${page.next_id}`,session,undefined,signal);if(!signal?.aborted)setPage(p=>({items:[...p.items,...v.items],next_id:v.next_id}));}
    catch(e){if(!signal?.aborted){setError(failure(e));if(e instanceof ApiError&&e.status===403)deny();}}finally{if(!signal?.aborted)setBusy(false);}
  }
  return <KeyboardFrame><FormScrollView style={{flex:1,backgroundColor:c.background}} contentContainerStyle={{padding:16,paddingTop:Math.max(16,insets.top),paddingBottom:Math.max(24,insets.bottom),alignItems:'center'}}>
    <View style={{width:'100%',maxWidth:680,gap:16}}>
      <AppHeader title={copy('title')} hideProfile inlineActions={<Button label={ui('common.back')} onPress={onBack} />} />
      <Text accessibilityRole="header" style={{color:c.text,fontFamily:fonts.medium,fontSize:24}}>{copy('title')}</Text>
      <Copy>{copy('group_help')}</Copy>
      <View style={{flexDirection:'row',flexWrap:'wrap',gap:8}}>
        <Button label={copy('pending')} selected={!reviewed} onPress={()=>setReviewed(false)} />
        <Button label={copy('reviewed')} selected={reviewed} onPress={()=>setReviewed(true)} />
        <Button label={copy('refresh')} disabled={busy} onPress={()=>setRevision(v=>v+1)} />
      </View>
      {!!error&&<Copy alert>{error}</Copy>}{busy&&<Copy>{copy('loading')}</Copy>}
      {!busy&&!error&&!page.items.length&&<Copy>{copy('empty')}</Copy>}
      {!denied&&page.items.map(group=><ReportGroup key={`${reviewed}-${revision}-${group.user_id}`} group={group} session={session} reviewed={reviewed} onDecision={()=>setRevision(v=>v+1)} onDenied={deny} />)}
      {!!page.next_id&&<Button label={copy('more')} disabled={busy} onPress={()=>void more()} />}
    </View>
  </FormScrollView></KeyboardFrame>;
}
export function ModerationEntry({session}: {session:Session}) {
  useUiLanguage();const [allowed,setAllowed]=useState(false),[open,setOpen]=useState(false);
  useEffect(()=>{const controller=new AbortController();setAllowed(false);setOpen(false);
    void sharedRequest<{moderator:boolean}>('/auth/moderation/capabilities',session,undefined,controller.signal).then(v=>{if(!controller.signal.aborted)setAllowed(v.moderator);}).catch(()=>{});
    return()=>controller.abort();},[session.token]);
  if(!allowed)return null;
  return <><Button label={copy('title')} onPress={()=>setOpen(true)} />
    {open&&<Modal visible animationType="slide" onRequestClose={()=>setOpen(false)}><ModerationPage session={session} onBack={()=>setOpen(false)} /></Modal>}</>;
}
