import { Ionicons } from '@expo/vector-icons';
import {AppText as Text} from './AppText';
import { useUiLanguage } from '../i18n/useUiLanguage';
import { ui, uiLabel } from '../i18n/copy.ts';
import { playerError } from '../multiplayer/playerError.ts';
import { FormInput } from './FormInput';
import { useEffect, useRef, useState } from 'react';
import {Pressable, View} from 'react-native';
import { request } from '../multiplayer/api';
import type { Session } from '../multiplayer/session';
import { pokeTextLength } from '../multiplayer/pokes';
import { radii, fonts, gameControlFinish, useTheme } from '../theme';

export function DisplayNameField({ session, onSaved, label }: { session: Session; label?: string; onSaved?: (name: string) => void }) {
  useUiLanguage();
  const { colors } = useTheme();
  const [name, setName] = useState(''), [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState(false), [savedName, setSavedName] = useState('');
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const lifetime = useRef<AbortController | null>(null);
  const pending = useRef(false);
  useEffect(() => {
    const controller = new AbortController(); lifetime.current = controller;
    setLoaded(false); setEditing(false); setMessage('');
    request<{ display_name: string }>('/me/profile', session, undefined, controller.signal)
      .then(profile => { if (!controller.signal.aborted) { setName(profile.display_name); setSavedName(profile.display_name); setLoaded(true); } })
      .catch(error => { if (!controller.signal.aborted) setMessage(playerError(error)); });
    return () => controller.abort();
  }, [session.user_id, session.token]);
  async function save() {
    const signal = lifetime.current?.signal;
    if (!editing || name === savedName || !loaded || pending.current || !signal || signal.aborted) return;
    pending.current = true; setBusy(true); setMessage('');
    try {
      const profile = await request<{ display_name: string }>('/me/profile', session, { display_name: name }, signal, 'PATCH');
      if (!signal.aborted) { setName(profile.display_name); setSavedName(profile.display_name); setEditing(false); setMessage(ui("feedback.display_name_saved")); onSaved?.(profile.display_name); }
    } catch (error) {
      if (!signal.aborted) setMessage(playerError(error, ui("common.name_save_failed")));
    } finally { pending.current = false; if (!signal.aborted) setBusy(false); }
  }
  return <View style={{ backgroundColor: colors.surface, padding: 20, borderRadius: 16, gap: 12 }}>
    <Text style={{ color: colors.text, fontFamily: fonts.medium }}>{label || ui("common.display_name_label")}</Text>
    <Text style={{ color: colors.textMuted, fontFamily: fonts.body, fontSize: 12, lineHeight: 20 }}>{ui("common.display_name_help")}</Text>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
    {editing ? <>
    <FormInput testID="profile-name-input" autoFocus accessibilityLabel={label || ui("common.game_display_name")} value={name} editable={loaded && !busy} maxLength={50}
      onChangeText={value => { setName(Array.from(value).slice(0,25).join('')); setMessage(''); }} placeholder={ui("common.name_nickname")}
      placeholderTextColor={colors.textMuted} autoCapitalize="words" returnKeyType="done" onSubmitEditing={() => void save()}
      style={{flex:1,minWidth:0,backgroundColor:colors.surfaceRaised,borderRadius:radii.medium,padding:12,minHeight:46,color:colors.text}} />
    <Pressable testID="profile-name-save" accessibilityRole="button" accessibilityLabel={ui('common.save_display_name')} accessibilityState={{disabled:busy||name===savedName}} disabled={busy||name===savedName} onPress={()=>void save()}
      style={{...gameControlFinish(colors),minHeight:44,padding:12,opacity:busy||name===savedName?0.5:1}}><Text style={{color:colors.text}}>{ui(busy?'common.saving':'common.save')}</Text></Pressable>
    </> : <>
      <Text testID="profile-name-value" style={{flex:1,color:colors.text}}>{name || ui('common.name_nickname')}</Text>
      <Pressable testID="profile-name-edit" accessibilityRole="button" accessibilityLabel={ui('common.edit_profile_name')} disabled={!loaded} onPress={()=>{setEditing(true);setMessage('');}}
        style={{...gameControlFinish(colors),minWidth:44,minHeight:44,alignItems:'center',justifyContent:'center'}}><Ionicons name="pencil-outline" size={20} color={colors.accent}/></Pressable>
    </>}
    </View>
    {editing && <View style={{flexDirection:'row',alignItems:'center',justifyContent:'space-between'}}>
      <Text style={{color:colors.textMuted,fontSize:12}}>{pokeTextLength(name)}/25</Text>
      <Pressable accessibilityRole="button" disabled={busy} onPress={()=>{setName(savedName);setEditing(false);setMessage('');}} style={{minHeight:44,justifyContent:'center'}}><Text style={{color:colors.accent}}>{ui('common.cancel')}</Text></Pressable>
    </View>}
    {!!message && <Text accessibilityLiveRegion="polite" style={{ color: colors.text }}>{uiLabel(message, 'feedback')}</Text>}
  </View>;
}
