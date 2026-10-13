import {useEffect, useRef, useState} from 'react';
import {ActivityIndicator, Pressable, View} from 'react-native';
import {AppText as Text} from './AppText';
import {PlayerAvatar} from './PlayerAvatar';
import {RoomSheet} from './RoomSheet';
import {presetAvatars} from '../multiplayer/presetAvatars';
import {request} from '../multiplayer/api';
import type {Session} from '../multiplayer/session';
import {playerError} from '../multiplayer/playerError';
import {ui} from '../i18n/copy';
import {useTheme} from '../theme';

export function AvatarPicker({session,onSaved}:{session:Session;onSaved:(uri:string|null)=>void}) {
  const {colors:c}=useTheme();
  const [visible,setVisible]=useState(false),[category,setCategory]=useState<'male'|'female'>('male');
  const [selected,setSelected]=useState<string|null>(null),[loaded,setLoaded]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [retry,setRetry]=useState(0);
  const pending=useRef(false);
  const lifetime=useRef<AbortController|null>(null);
  useEffect(()=>{const controller=new AbortController();lifetime.current=controller;setLoaded(false);setError('');
    request<{avatar_id:string|null;avatar_url:string|null}>('/me/profile/avatar',session,undefined,controller.signal)
      .then(value=>{if(!controller.signal.aborted){setSelected(value.avatar_id);setCategory(value.avatar_id?.startsWith('female')?'female':'male');setLoaded(true);onSaved(value.avatar_url);}})
      .catch(reason=>{if(!controller.signal.aborted)setError(playerError(reason));});
    return()=>controller.abort();
  },[session.user_id,session.token,retry]);
  async function choose(avatar_id:string|null){
    const signal=lifetime.current?.signal;if(!loaded||pending.current||!signal||signal.aborted)return;
    pending.current=true;setBusy(true);setError('');
    try{const result=await request<{avatar_id:string|null;avatar_url:string|null}>('/me/profile/avatar',session,{avatar_id},signal,'PATCH');
      if(!signal.aborted){setSelected(result.avatar_id);onSaved(result.avatar_url);setVisible(false);}
    }catch(reason){if(!signal.aborted)setError(playerError(reason));}
    finally{pending.current=false;if(!signal.aborted)setBusy(false);}
  }
  const option=(id:string|null,label:string)=><Pressable key={id??'default'} testID={`avatar-choice-${id??'default'}`} accessibilityRole="radio" accessibilityLabel={label} aria-checked={selected===id} accessibilityState={{checked:selected===id,disabled:busy||!loaded}} disabled={busy||!loaded} onPress={()=>void choose(id)} style={{padding:4,borderRadius:40,borderWidth:2,borderColor:selected===id?c.accent:'transparent',opacity:busy||!loaded?0.5:1}}><PlayerAvatar size={64} uri={id?`preset:${id}`:undefined}/></Pressable>;
  return <><Pressable testID="profile-avatar-edit" accessibilityRole="button" accessibilityLabel={ui('common.choose_avatar')} onPress={()=>setVisible(true)} style={{minWidth:48,minHeight:48,alignItems:'center',justifyContent:'center'}}><PlayerAvatar size={44} uri={selected?`preset:${selected}`:undefined}/><Text style={{color:c.accent,fontSize:12}}>⌄</Text></Pressable>
    <RoomSheet visible={visible} onClose={()=>setVisible(false)} title={ui('common.choose_avatar')} presentation="dialog" testID="profile-avatar-picker">
      <View accessibilityRole="radiogroup" accessibilityLabel={ui('common.choose_avatar')} style={{flexDirection:'row',gap:24}}>{(['male','female'] as const).map(value=><Pressable key={value} accessibilityLabel={ui(value==='male'?'common.avatar_male':'common.avatar_female')} accessibilityRole="radio" aria-checked={category===value} accessibilityState={{checked:category===value}} onPress={()=>setCategory(value)} style={{minHeight:44,justifyContent:'center'}}><Text style={{color:category===value?c.accent:c.text}}>{category===value?'◉':'○'} {ui(value==='male'?'common.avatar_male':'common.avatar_female')}</Text></Pressable>)}</View>
      {!loaded&&!error&&<View style={{flexDirection:'row',alignItems:'center',gap:8}}><ActivityIndicator size="small" color={c.textMuted}/><Text style={{color:c.textMuted,fontSize:12}}>{ui('common.loading_profile')}</Text></View>}
      <View style={{flexDirection:'row',alignItems:'center',gap:12}}>{option(null,ui('common.default_avatar'))}<Text style={{color:c.text}}>{ui('common.default_avatar')}</Text></View>
      <View style={{flexDirection:'row',flexWrap:'wrap',gap:8}}>{Object.keys(presetAvatars).filter(id=>id.startsWith(category)).map(id=>option(id,`${ui(category==='male'?'common.avatar_male':'common.avatar_female')} ${Number(id.slice(-2))}`))}</View>
      {!!error&&<View style={{gap:4}}><Text accessibilityRole="alert" style={{color:c.danger}}>{error}</Text>{!loaded&&<Pressable accessibilityRole="button" onPress={()=>setRetry(value=>value+1)} style={{minHeight:44,justifyContent:'center'}}><Text style={{color:c.accent}}>{ui('common.retry')}</Text></Pressable>}</View>}
    </RoomSheet></>;
}
