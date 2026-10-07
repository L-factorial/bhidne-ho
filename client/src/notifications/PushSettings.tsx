import {FormInput} from '../components/FormInput';
import {AppText as Text} from '../components/AppText';
import {useEffect,useState} from 'react';
import {Pressable, TextInput, View} from 'react-native';
import {useTheme,fonts} from '../theme';
import {ui} from '../i18n/copy';
import {useUiLanguage} from '../i18n/useUiLanguage';
import {usePush} from './PushProvider';
import {parseQuietTime,formatQuietTime} from './quietTime';
export function PushSettings(){
  useUiLanguage();
  const push=usePush(),{colors:c}=useTheme();
  const [start,setStart]=useState('22:00'),[end,setEnd]=useState('08:00'),[error,setError]=useState('');
  useEffect(()=>{if(push?.preferences.quiet_start!==null&&push?.preferences.quiet_start!==undefined){
    setStart(formatQuietTime(push.preferences.quiet_start));setEnd(formatQuietTime(push.preferences.quiet_end!));
  }},[push?.preferences.quiet_start,push?.preferences.quiet_end]);
  if(!push?.available)return null;
  const toggle=(key:'actions'|'invitations'|'sound')=><Pressable key={key} accessibilityRole="switch" accessibilityState={{checked:push.preferences[key],disabled:push.busy}} disabled={push.busy}
    onPress={()=>void push.save({...push.preferences,[key]:!push.preferences[key]})} style={{minHeight:44,justifyContent:'center'}}>
    <Text style={{color:c.text}}>{ui(`common.push_${key}`)} · {ui(push.preferences[key]?'common.push_on':'common.push_off')}</Text>
  </Pressable>;
  async function quiet(){
    const a=parseQuietTime(start),b=parseQuietTime(end);
    if(a===null||b===null||a===b){setError(ui('common.push_quiet_invalid'));return;}
    setError('');await push.save({...push.preferences,quiet_start:a,quiet_end:b});
  }
  return <View testID="push-settings" style={{gap:8,borderWidth:1,borderColor:c.border,borderRadius:14,padding:14}}>
    <Text style={{fontFamily:fonts.medium,color:c.text}}>{ui('common.push_title')}</Text>
    <Text style={{color:c.textMuted}}>{ui('common.push_help')}</Text>
    <Pressable accessibilityRole="switch" accessibilityState={{checked:push.enabled,disabled:push.busy}} disabled={push.busy} onPress={()=>void (push.enabled?push.disable():push.enable())} style={{minHeight:44,justifyContent:'center'}}>
      <Text style={{color:c.accent}}>{ui(push.enabled?'common.push_disable':'common.push_enable')}</Text>
    </Pressable>
    {push.enabled&&<>{(['actions','invitations','sound'] as const).map(toggle)}
      <Text style={{color:c.text}}>{ui('common.push_quiet')}</Text>
      <View style={{flexDirection:'row',gap:8}}>{([['start',start,setStart],['end',end,setEnd]] as const).map(([key,value,set])=><FormInput key={key} accessibilityLabel={ui(key==='start'?'common.push_quiet_start':'common.push_quiet_end')} value={value} onChangeText={set} placeholder="HH:MM" maxLength={5} editable={!push.busy} style={{color:c.text,borderColor:c.border,borderWidth:1,padding:10,minHeight:44,flex:1}} />)}</View>
      <Pressable accessibilityRole="button" disabled={push.busy} onPress={()=>void quiet()} style={{minHeight:44,justifyContent:'center'}}><Text style={{color:c.accent}}>{ui('common.push_quiet_save')}</Text></Pressable>
      {push.preferences.quiet_start!==null&&<Pressable accessibilityRole="button" disabled={push.busy} onPress={()=>void push.save({...push.preferences,quiet_start:null,quiet_end:null})} style={{minHeight:44,justifyContent:'center'}}><Text style={{color:c.accent}}>{ui('common.push_quiet_disable')}</Text></Pressable>}
    </>}
    {!!(error||push.error)&&<Text accessibilityRole="alert" style={{color:c.danger}}>{error||push.error}</Text>}
  </View>;
}
