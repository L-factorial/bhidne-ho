import {AppText} from './AppText';
import {useEffect,useRef,useState} from 'react';
import {AccessibilityInfo,Animated,View} from 'react-native';
import {ui} from '../i18n/copy';
import {useUiLanguage} from '../i18n/useUiLanguage';
import {fonts,useTheme} from '../theme';
const AnimatedText=Animated.createAnimatedComponent(AppText);
export function TableTransfer(){
 useUiLanguage();const {colors}=useTheme(),opacity=useRef(new Animated.Value(1)).current;
 const [reduce,setReduce]=useState(true);
 useEffect(()=>{let live=true;void AccessibilityInfo.isReduceMotionEnabled().then(value=>{if(live)setReduce(value);}).catch(()=>{});const listener=AccessibilityInfo.addEventListener('reduceMotionChanged',setReduce);return()=>{live=false;listener.remove();};},[]);
 useEffect(()=>{if(reduce){opacity.setValue(1);return;}const pulse=Animated.loop(Animated.sequence([Animated.timing(opacity,{toValue:.45,duration:700,useNativeDriver:true}),Animated.timing(opacity,{toValue:1,duration:700,useNativeDriver:true})]));pulse.start();return()=>{pulse.stop();opacity.setValue(1);};},[reduce,opacity]);
 return <View testID="table-transfer" accessibilityViewIsModal style={{position:'absolute',inset:0,backgroundColor:colors.background,alignItems:'center',justifyContent:'center',gap:24,zIndex:20}}>
  <AnimatedText accessibilityLiveRegion="polite" style={{opacity,color:colors.text,fontFamily:fonts.medium,fontSize:18,textAlign:'center',padding:24}}>{ui('feedback.taking_you_to_table')}</AnimatedText>

 </View>;
}
