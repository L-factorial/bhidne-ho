import {useEffect,useRef,useState} from 'react';
import {AppState,Pressable,View} from 'react-native';
import {AppText as Text} from './AppText';
import {FloatingTableAction} from './FloatingTableAction';
import {ui} from '../i18n/copy';
import {fonts,useTheme} from '../theme';

/** Foreground presentation countdown; only the eligible cutter mounts this. */
export function CutDeckActions({disabled,onCut,onSkip}:{disabled:boolean;onCut:()=>void;onSkip:()=>void}) {
  const {colors}=useTheme();
  const [seconds,setSeconds]=useState(10);
  const submitted=useRef(false);
  const skip=useRef(onSkip);skip.current=onSkip;
  useEffect(()=>{
    if(disabled||submitted.current)return;
    const timer=setInterval(()=>{
      if(AppState.currentState!=='active'||(typeof document!=='undefined'&&document.hidden))return;
      setSeconds(value=>Math.max(0,value-1));
    },1000);
    return()=>clearInterval(timer);
  },[disabled]);
  useEffect(()=>{
    if(seconds!==0||disabled||submitted.current)return;
    submitted.current=true;skip.current();
  },[seconds,disabled]);
  return <View testID="cut-deck-actions" style={{alignItems:'center',gap:8}}>
    <FloatingTableAction label={ui('callbreak.cut_in_half')} disabled={disabled} onPress={()=>{submitted.current=true;onCut();}}/>
    <Pressable accessibilityRole="button" accessibilityLabel={ui('callbreak.skip_cut')} accessibilityState={{disabled}} disabled={disabled}
      onPress={()=>{submitted.current=true;onSkip();}} style={{minHeight:44,minWidth:80,alignItems:'center',justifyContent:'center'}}>
      <Text style={{color:colors.accent,fontFamily:fonts.medium,fontSize:14}}>{ui('callbreak.skip_cut')}</Text>
    </Pressable>
    <Text testID="cut-deck-countdown" style={{color:colors.textMuted,fontSize:12,textAlign:'center'}}>{ui('callbreak.auto_skip_countdown',{seconds})}</Text>
  </View>;
}
