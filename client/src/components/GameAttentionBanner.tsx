import {useEffect, useRef, useState, type ReactNode} from 'react';
import {AccessibilityInfo, Animated, Pressable, Text, View} from 'react-native';
import {fonts, useTheme} from '../theme';
import {ui} from '../i18n/copy';
import {useUiLanguage} from '../i18n/useUiLanguage';
import type {GameAttention} from '../notifications/gameAttention';

export function GameAttentionBanner({attention, onPress, idleContent, endControl, expanded}: {attention:GameAttention|null; onPress?:()=>void; idleContent?:ReactNode; endControl?:ReactNode; expanded?:boolean}) {
  useUiLanguage();
  const {colors:c} = useTheme();
  const pulse = useRef(new Animated.Value(1)).current;
  const [reduced, setReduced] = useState(true);
  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isReduceMotionEnabled().then(value => {if(active)setReduced(value);}).catch(() => {});
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged',setReduced);
    return () => {active=false;subscription.remove();};
  },[]);
  useEffect(() => {
    pulse.setValue(1);
    if(!attention || reduced)return;
    const animation = Animated.loop(Animated.sequence([
      Animated.timing(pulse,{toValue:0.35,duration:650,useNativeDriver:true}),
      Animated.timing(pulse,{toValue:1,duration:650,useNativeDriver:true}),
    ]),{iterations:attention.required ? -1 : 3});
    animation.start();
    return () => {animation.stop();pulse.setValue(1);};
  },[attention?.key,attention?.required,reduced,pulse]);
  const title = attention ? ui(attention.title) : ui('common.your_cards');
  const detail = attention ? ui(attention.detail) : '';
  const opportunities = attention?.opportunities.filter(key => attention.required || key !== attention.title) || [];
  const rays = (side:'left'|'right') => <Animated.View pointerEvents="none" style={{width:15,gap:7,opacity:attention ? pulse : 0,alignItems:'center'}}>
    {[-30,0,30].map(angle => <View key={angle} testID={`attention-ray-${side}-${angle}`} style={{width:12,height:2,borderRadius:2,backgroundColor:c.tableTrim,transform:[{rotate:`${side==='left' ? angle : -angle}deg`}]}} />)}
  </Animated.View>;
  const body = <View style={{flexDirection:'row',alignItems:'center',gap:4,minHeight:64}}>
    {rays('left')}
    <View style={{flex:1,minWidth:0,borderRadius:18,borderWidth:1,borderColor:attention ? c.tableTrim : c.border,backgroundColor:c.tableHeader,paddingHorizontal:12,paddingVertical:9,flexDirection:'row',alignItems:'center',gap:10}}>
      {!!attention && <Animated.View pointerEvents="none" style={{position:'absolute',inset:0,borderRadius:18,borderWidth:1,borderColor:c.tableTrim,opacity:pulse,boxShadow:`0 0 12px ${c.tableTrim}`}} />}
      {!attention && idleContent ? <View style={{flex:1,minWidth:0}}>{idleContent}</View> : <><Text style={{color:c.tableTrim,fontSize:24}}>♠</Text>
      <View style={{flex:1,minWidth:0}}><Text accessibilityLiveRegion="polite" numberOfLines={2} style={{fontFamily:fonts.medium,color:attention ? c.tableTrim : c.onTableHeader,fontSize:15}}>{title}</Text>
        {!!detail && <Text style={{fontFamily:fonts.body,color:c.onTableHeader,fontSize:12}}>{detail}</Text>}
        {!!opportunities.length && <Text numberOfLines={1} style={{color:c.tableTrim,fontSize:11}}>{opportunities.map(key=>ui(key)).join(' · ')}</Text>}
      </View></>}{endControl}
    </View>{rays('right')}
  </View>;
  return onPress ? <Pressable testID={expanded ? "hand-attention-expanded" : "hand-attention-collapsed"} accessibilityRole="button" accessibilityState={{expanded}} accessibilityLabel={`${ui(expanded ? "common.collapse_your_card_area" : "common.expand_your_card_area")}. ${title}. ${detail}`} onPress={onPress} style={{flex:1,minWidth:0}}>{body}</Pressable> : <View testID="game-attention-expanded" style={{width:'100%',flexShrink:0}}>{body}</View>;
}
