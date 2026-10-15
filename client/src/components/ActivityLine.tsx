import {useEffect, useRef, useState} from 'react';
import {AccessibilityInfo, Animated, View} from 'react-native';
import {LinearGradient} from 'expo-linear-gradient';
import {useTheme} from '../theme';
import {ui} from '../i18n/copy';

/** Nonblocking progress; failures and actions remain separate, readable controls. */
export function ActivityLine({active = true}: {active?: boolean}) {
  const {colors} = useTheme();
  const opacity = useRef(new Animated.Value(.5)).current;
  const [reduced, setReduced] = useState(true);
  useEffect(() => { let alive=true; void AccessibilityInfo.isReduceMotionEnabled().then(value=>{if(alive)setReduced(value);}); const sub=AccessibilityInfo.addEventListener('reduceMotionChanged',setReduced); return ()=>{alive=false;sub.remove();}; },[]);
  useEffect(()=>{ if(!active||reduced)return; const animation=Animated.loop(Animated.sequence([Animated.timing(opacity,{toValue:1,duration:900,useNativeDriver:true}),Animated.timing(opacity,{toValue:.2,duration:900,useNativeDriver:true})])); animation.start(); return ()=>animation.stop(); },[active,reduced,opacity]);
  if(!active)return null;
  return <View testID="activity-line" accessibilityRole="progressbar" accessibilityLabel={ui('common.loading_bhidne_ho')} accessibilityState={{busy:true}} pointerEvents="none" style={{width:'100%',minWidth:16,height:3,overflow:'hidden'}}>
    <Animated.View style={{opacity}}><LinearGradient colors={['transparent',colors.accent,'transparent']} start={{x:0,y:0}} end={{x:1,y:0}} style={{height:2,width:'100%'}}/></Animated.View>
  </View>;
}
