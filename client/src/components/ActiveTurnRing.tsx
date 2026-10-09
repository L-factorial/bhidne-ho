import {useEffect, useRef, useState} from 'react';
import {AccessibilityInfo, Animated, Easing, View} from 'react-native';
import {useTheme} from '../theme';

/** Presentation only: the authoritative decision actor determines when this ring is shown. */
export function ActiveTurnRing({active,size}:{active:boolean;size:number}) {
  const {colors:c}=useTheme();
  const [reduced,setReduced]=useState(true);
  const progress=useRef(new Animated.Value(0)).current;
  useEffect(()=>{let mounted=true;void AccessibilityInfo.isReduceMotionEnabled().then(value=>{if(mounted)setReduced(value);}).catch(()=>{});
    const subscription=AccessibilityInfo.addEventListener('reduceMotionChanged',setReduced);
    return()=>{mounted=false;subscription.remove();};},[]);
  useEffect(()=>{progress.setValue(0);if(!active||reduced)return;
    const animation=Animated.loop(Animated.timing(progress,{toValue:1,duration:1800,easing:Easing.out(Easing.quad),useNativeDriver:true}));animation.start();
    return()=>{animation.stop();progress.setValue(0);};},[active,reduced,progress]);
  if(!active)return null;
  const diameter=size+6;
  return <View testID="active-turn-ring" pointerEvents="none" accessible={false} style={{position:'absolute',left:'50%',top:'50%',marginLeft:-diameter/2,marginTop:-diameter/2,width:diameter,height:diameter}}>
    <Animated.View style={{width:diameter,height:diameter,borderRadius:diameter/2,borderWidth:2,borderColor:c.accent,
      opacity:reduced?1:progress.interpolate({inputRange:[0,.75,1],outputRange:[1,.35,0]}),
      transform:[{scale:reduced?1:progress.interpolate({inputRange:[0,1],outputRange:[1,1.3]})}]}}/>
  </View>;
}
