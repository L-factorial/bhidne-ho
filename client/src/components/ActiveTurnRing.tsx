import {useEffect, useRef, useState} from 'react';
import {AccessibilityInfo, Animated, View} from 'react-native';
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
    const animation=Animated.loop(Animated.timing(progress,{toValue:1,duration:1800,useNativeDriver:true}));animation.start();
    return()=>{animation.stop();progress.setValue(0);};},[active,reduced,progress]);
  if(!active)return null;
  const diameter=size+6;
  return <View testID="active-turn-ring" pointerEvents="none" accessible={false} style={{position:'absolute',left:-3,top:-3,width:diameter,height:diameter}}>
    <Animated.View style={{width:diameter,height:diameter,borderRadius:diameter/2,borderWidth:2,borderColor:c.accent,
      opacity:reduced?1:progress.interpolate({inputRange:[0,.5,1],outputRange:[.6,1,.6]}),
      transform:[{scale:reduced?1:progress.interpolate({inputRange:[0,.5,1],outputRange:[1,1.12,1]})}]}}/>
    {!reduced&&<Animated.View style={{position:'absolute',width:diameter,height:diameter,borderRadius:diameter/2,borderWidth:3,
      borderColor:'transparent',borderTopColor:c.accent,borderRightColor:c.accent,
      transform:[{rotate:progress.interpolate({inputRange:[0,1],outputRange:['0deg','360deg']})}]}}/>}
  </View>;
}
