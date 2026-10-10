import {FormInput} from '../components/FormInput';
import {AppText as Text} from '../components/AppText';
import {useEffect,useState} from 'react';
import {Pressable, Switch, View} from 'react-native';
import { radii, useTheme,fonts} from '../theme';
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
  const toggle=(key:'actions'|'invitations'|'sound')=><View key={key} style={{minHeight:52,flexDirection:'row',alignItems:'center',gap:12}}>
    <Text style={{color:c.text,flex:1}}>{ui(`common.push_${key}`)} · {ui(push.preferences[key]?'common.push_on':'common.push_off')}</Text>
    <Switch testID={`push-switch-${key}`} accessibilityLabel={ui(`common.push_${key}`)} disabled={push.busy} value={push.preferences[key]}
      onValueChange={value=>void push.save({...push.preferences,[key]:value})} trackColor={{false:c.border,true:c.accent}} thumbColor={c.surface} />
  </View>;
  async function quiet(){
    const a=parseQuietTime(start),b=parseQuietTime(end);
    if(a===null||b===null||a===b){setError(ui('common.push_quiet_invalid'));return;}
    setError('');await push.save({...push.preferences,quiet_start:a,quiet_end:b});
  }
  return <View testID="push-settings" style={{gap:8,borderWidth:1,borderColor:c.border,borderRadius: radii.medium,padding:14}}>
    <Text style={{fontFamily:fonts.medium,color:c.text}}>{ui('common.push_title')}</Text>
    <Text style={{color:c.textMuted}}>{ui('common.push_help')}</Text>
    <View style={{minHeight:52,flexDirection:'row',alignItems:'center',gap:12}}>
      <Text style={{color:c.text,flex:1}}>{ui('common.push_title')} · {ui(push.enabled?'common.push_on':'common.push_off')}</Text>
      <Switch testID="push-switch-device" accessibilityLabel={ui('common.push_title')} disabled={push.busy} value={push.enabled}
        onValueChange={value=>void (value?push.enable():push.disable())} trackColor={{false:c.border,true:c.accent}} thumbColor={c.surface} />
    </View>
    {push.enabled&&<>{(['actions','invitations','sound'] as const).map(toggle)}
      <Text style={{color:c.text}}>{ui('common.push_quiet')}</Text>
      <View style={{flexDirection:'row',gap:8}}>{([['start',start,setStart],['end',end,setEnd]] as const).map(([key,value,set])=><FormInput key={key} accessibilityLabel={ui(key==='start'?'common.push_quiet_start':'common.push_quiet_end')} value={value} onChangeText={set} placeholder="HH:MM" maxLength={5} editable={!push.busy} style={{color:c.text,borderColor:c.border,borderWidth:1,padding:10,minHeight:44,flex:1}} />)}</View>
      <Pressable accessibilityRole="button" disabled={push.busy} onPress={()=>void quiet()} style={{minHeight:44,justifyContent:'center'}}><Text style={{color:c.accent}}>{ui('common.push_quiet_save')}</Text></Pressable>
      {push.preferences.quiet_start!==null&&<Pressable accessibilityRole="button" disabled={push.busy} onPress={()=>void push.save({...push.preferences,quiet_start:null,quiet_end:null})} style={{minHeight:44,justifyContent:'center'}}><Text style={{color:c.accent}}>{ui('common.push_quiet_disable')}</Text></Pressable>}
    </>}
    {!!(error||push.error)&&<Text accessibilityRole="alert" style={{color:c.danger}}>{error||push.error}</Text>}
  </View>;
}
