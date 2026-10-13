import {AppText as Text} from './AppText';
import {AccessibilityInfo, Animated, View} from 'react-native';
import {useEffect, useRef, useState} from 'react';
import {fonts, useTheme} from '../theme';

export function TurnStatus({text}: {text:string}) {
  const {colors}=useTheme();
  const opacity=useRef(new Animated.Value(1)).current;
  const [reduced,setReduced]=useState(true);
  useEffect(()=>{
    let active=true;
    void AccessibilityInfo.isReduceMotionEnabled().then(value=>{if(active)setReduced(value);}).catch(()=>{});
    const listener=AccessibilityInfo.addEventListener('reduceMotionChanged',setReduced);
    return()=>{active=false;listener.remove();};
  },[]);
  useEffect(()=>{
    opacity.setValue(1);
    if(reduced)return;
    const loop=Animated.loop(Animated.sequence([
      Animated.timing(opacity,{toValue:0.25,duration:700,useNativeDriver:true}),
      Animated.timing(opacity,{toValue:1,duration:700,useNativeDriver:true}),
    ]));
    loop.start();return()=>{loop.stop();opacity.stopAnimation();};
  },[opacity,reduced]);
  return <View testID="marriage-card-turn" style={{width:'100%',flexDirection:'row',alignItems:'center',justifyContent:'center',gap:8,paddingTop:12,paddingBottom:2}}>
    <Animated.View accessible={false} style={{width:9,height:9,borderRadius:5,backgroundColor:colors.coin,opacity}}/>
    <Text accessibilityLiveRegion="polite" style={{fontFamily:fonts.medium,fontSize:13,color:colors.text,flexShrink:1,textAlign:'center'}}>{text}</Text>
  </View>;
}
