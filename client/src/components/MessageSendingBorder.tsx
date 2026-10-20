import {useEffect,useRef,useState} from 'react';
import {AccessibilityInfo,Animated} from 'react-native';
import {ui} from '../i18n/copy';
import {radii,useTheme} from '../theme';
/** Animate only the bubble boundary; no extra loading row or moving content. */
export function MessageSendingBorder({confirming}:{confirming:boolean}){
  const {colors}=useTheme();
  const opacity=useRef(new Animated.Value(0.55)).current;
  const [reduced,setReduced]=useState(true);
  useEffect(()=>{
    let live=true;
    void AccessibilityInfo.isReduceMotionEnabled().then(value=>{if(live)setReduced(value);}).catch(()=>{});
    const listener=AccessibilityInfo.addEventListener('reduceMotionChanged',setReduced);
    return()=>{live=false;listener.remove();};
  },[]);
  useEffect(()=>{
    if(reduced){opacity.setValue(0.55);return;}
    const animation=Animated.loop(Animated.sequence([
      Animated.timing(opacity,{toValue:1,duration:900,useNativeDriver:true}),
      Animated.timing(opacity,{toValue:0.2,duration:900,useNativeDriver:true}),
    ]));
    animation.start();return()=>animation.stop();
  },[reduced,opacity]);
  return <Animated.View testID="chat-sending-border" pointerEvents="none" accessibilityRole="progressbar"
    accessibilityLabel={ui(confirming?'social.confirming_message':'social.sending')}
    style={{position:'absolute',inset:0,borderWidth:1,borderRadius:radii.medium,borderColor:colors.accent,opacity}}/>;
}
