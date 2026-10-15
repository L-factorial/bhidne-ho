import {AppText as Text} from '../components/AppText';
import { useContext, useEffect, useState } from 'react';
import {Pressable, View} from 'react-native';
import { AccountPage, accountStyles } from '../components/AccountPage';
import { FormInput } from '../components/FormInput';
import { DeletionNavigation } from '../auth/deletion';
import { readAuthValue, writeAuthValue } from '../auth/storage';
import { apiUrl, ApiError, sharedRequest } from '../multiplayer/api';
import { saveSession, type Session } from '../multiplayer/session';
import { visualStates, useTheme } from '../theme';
import { useUiLanguage } from '../i18n/useUiLanguage';
import { ui } from '../i18n/copy';
import type { UiKey } from '../i18n/catalogs';
const statusKey = `bhidne.deletion.v1:${apiUrl}`;
type Blocker={kind:'leave_table'|'end_table'|'settle_ledger'|'pending_actions';room_id?:string;room_name?:string;table_id?:string;name?:string};
type Preflight={ready:boolean;blockers:Blocker[];email_verified:boolean};
function savedStatus() { try { return readAuthValue(statusKey) || ''; } catch { return ''; } }
export function DeleteAccountLink() {
  const open = useContext(DeletionNavigation); const {colors} = useTheme();useUiLanguage();
  return <Pressable accessibilityRole="button" onPress={open} style={{minHeight:48,justifyContent:'center',padding:12}}><Text style={{color:colors.danger}}>{ui('deletion.title')}</Text></Pressable>;
}
export function DeletionScreen({session,token,onClose}: {session:Session|null;token:string|null;onClose:()=>void}) {
  useUiLanguage();const {colors}=useTheme();const styles=accountStyles(colors);
  const [enabled,setEnabled]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [username,setUsername]=useState(''),[email,setEmail]=useState(''),[password,setPassword]=useState(''),[confirmation,setConfirmation]=useState('');
  const [sent,setSent]=useState(false),[statusToken,setStatusToken]=useState(()=>session||token?'':savedStatus()),[status,setStatus]=useState('pending');
  const [preflight,setPreflight]=useState<Preflight|null>(null),[checking,setChecking]=useState(false),[refresh,setRefresh]=useState(0);
  useEffect(()=>{const c=new AbortController();void sharedRequest<{enabled:boolean}>('/auth/deletion/capabilities',null,undefined,c.signal).then(v=>setEnabled(v.enabled)).catch(()=>{});return()=>c.abort();},[]);
  useEffect(()=>{
    if(!enabled||(!session&&!token)||statusToken)return;
    const c=new AbortController();setChecking(true);setPreflight(null);
    void sharedRequest<Preflight>('/auth/deletion/preflight',token?null:session,token?{token}:undefined,c.signal)
      .then(value=>{if(!c.signal.aborted){setPreflight(value);setError('');}})
      .catch(()=>{if(!c.signal.aborted)setError(ui('deletion.failure'));})
      .finally(()=>{if(!c.signal.aborted)setChecking(false);});
    return()=>c.abort();
  },[enabled,session?.token,token,refresh,statusToken]);
  useEffect(()=>{
    if(!statusToken||!enabled)return;
    const c=new AbortController();let timer:ReturnType<typeof setTimeout>;
    async function poll(){try{const value=await sharedRequest<{status:string}>('/auth/deletion/status',null,{token:statusToken},c.signal);
      if(!c.signal.aborted){setStatus(value.status);if(value.status!=='completed')timer=setTimeout(poll,5000);}
    }catch{if(!c.signal.aborted)timer=setTimeout(poll,15000);}}
    void poll();return()=>{c.abort();clearTimeout(timer);};
  },[statusToken,enabled]);
  async function submit(){
    if(busy||!enabled||((session||token)&&(!preflight?.ready||checking))||(!token&&session&&!preflight?.email_verified))return;setBusy(true);setError('');
    try {
      if(!session&&!token){await sharedRequest('/auth/deletion/email',null,{username:username.trim(),email:email.trim()});setSent(true);}
      else if(!token){await sharedRequest('/auth/deletion/request',session,{current_password:password});setPassword('');setSent(true);}
      else {const result=await sharedRequest<{status_token:string}>('/auth/deletion/confirm',null,{token,confirmation});
        saveSession(apiUrl,null);setPassword('');setConfirmation('');setStatusToken(result.status_token);
        try{writeAuthValue(statusKey,result.status_token);}catch{setError(ui('deletion.keepOpen'));}
      }
    }catch(e){const code=e instanceof ApiError?e.detail?.code:undefined;
      const known=['deletion_invalid_proof','deletion_leave_games','deletion_unsettled_ledger','deletion_verify_email','deletion_pending_actions','deletion_reauthenticate','deletion_limited'];
      if(code==='deletion_leave_games'||code==='deletion_unsettled_ledger'||code==='deletion_pending_actions')setRefresh(value=>value+1);
      setError(ui((known.includes(String(code))?`deletion.${code}`:'deletion.failure') as UiKey));
    }finally{setBusy(false);}
  }
  const confirming=!!token;
  const blocked=(!!session||!!token)&&(!preflight?.ready||checking||(!token&&!preflight?.email_verified));
  return <AccountPage footer={<>
    {!statusToken&&!sent&&<Pressable accessibilityRole="button" disabled={!enabled||busy||blocked||(confirming?confirmation!=='DELETE':session?!password:!username.trim()||!email.trim())} onPress={()=>void submit()}
      style={[styles.button,{backgroundColor:colors.destructiveAction},(!enabled||busy)&&{opacity:visualStates.disabledOpacity}]}><Text style={[styles.buttonText,{color:colors.onDestructive}]}>{ui(confirming?'deletion.confirm':'deletion.send')}</Text></Pressable>}
    <Pressable accessibilityRole="button" disabled={busy} onPress={()=>{if(status==='completed'){try{writeAuthValue(statusKey,null);}catch{}}onClose();}} style={styles.button}><Text style={styles.buttonText}>{ui('common.back_label')}</Text></Pressable>
  </>}>
    <Text accessibilityRole="header" style={styles.title}>{ui('deletion.title')}</Text>
    {!enabled&&<Text style={styles.description}>{ui('deletion.unavailable')}</Text>}
    <Text style={styles.description}>{ui('deletion.explanation')}</Text>
    <Text style={styles.description}>{ui('deletion.history')}</Text>
    <Text style={styles.description}>{ui('deletion.backups')}</Text>
    <Text style={styles.description}>{ui('deletion.requirements')}</Text>
    {!statusToken&&!sent&&enabled&&(session||token)&&<>
      {checking&&<Text activity accessibilityRole="alert" style={styles.description}>{ui('deletion.checking')}</Text>}
      {preflight?.blockers.map((item,index)=><View key={`${item.kind}-${item.table_id||index}`} style={{gap:4,paddingVertical:8}}>
        <Text style={{color:colors.danger}}>{ui(`deletion.${item.kind}`)}</Text>
        {!!(item.name||item.room_name)&&<Text style={styles.description}>{[item.name,item.room_name].filter(Boolean).join(' · ')}</Text>}
      </View>)}
      {preflight&&!token&&!preflight.email_verified&&<Text style={{color:colors.danger}}>{ui('deletion.deletion_verify_email')}</Text>}
      <Pressable accessibilityRole="button" disabled={checking||busy} onPress={()=>setRefresh(value=>value+1)} style={styles.button}><Text style={styles.buttonText}>{ui('deletion.check_again')}</Text></Pressable>
      {!!preflight?.blockers.length&&<Pressable accessibilityRole="button" onPress={onClose} style={styles.button}><Text style={styles.buttonText}>{ui('deletion.resolve_in_app')}</Text></Pressable>}
    </>}
    {statusToken?<Text accessibilityRole="alert" style={styles.description}>{ui(status==='completed'?'deletion.completed':status==='failed'?'deletion.retrying':'deletion.pending')}</Text>
      :sent?<Text accessibilityRole="alert" style={styles.description}>{ui(session?'deletion.sent_authenticated':'deletion.sent')}</Text>:<>
        {!confirming&&!session&&<><Text style={styles.description}>{ui('deletion.emailHelp')}</Text>
          <FormInput accessibilityLabel={ui('common.username')} placeholder={ui('common.username')} value={username} onChangeText={setUsername} autoCapitalize="none" style={styles.input}/>
          <FormInput accessibilityLabel={ui('common.email')} placeholder={ui('common.email')} value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" style={styles.input}/></>}
        {session&&!token&&<><Text style={styles.description}>{ui('deletion.passwordHelp')}</Text><FormInput accessibilityLabel={ui('recovery.currentPassword')} placeholder={ui('recovery.currentPassword')} value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" style={styles.input}/></>}
        {confirming&&<><Text style={styles.description}>{ui('deletion.typeDelete')}</Text><FormInput accessibilityLabel={ui('deletion.typeDelete')} value={confirmation} onChangeText={setConfirmation} autoCapitalize="characters" style={styles.input}/></>}
      </>}
    {!!error&&<Text activity accessibilityRole="alert" style={{color:colors.danger}}>{error}</Text>}
  </AccountPage>;
}
