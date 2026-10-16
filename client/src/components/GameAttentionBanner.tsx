import { CardBack } from './CardBack';
import {AppText as Text} from './AppText';
import {useEffect, useRef, useState, type ReactNode} from 'react';
import {AccessibilityInfo, Animated, Pressable, View, Text as SmallText} from 'react-native';
import { radii, fonts, useTheme} from '../theme';
import {ui} from '../i18n/copy';
import {useUiLanguage} from '../i18n/useUiLanguage';
import type {GameAttention} from '../notifications/gameAttention';

export function GameAttentionBanner({attention, onPress, idleContent, endControl, expanded, disabled = false, cardsTitle = false, compact = false, compactLabel}: {compactLabel?:string;compact?:boolean;cardsTitle?:boolean; attention:GameAttention|null; onPress?:()=>void; idleContent?:ReactNode; endControl?:ReactNode; expanded?:boolean; disabled?:boolean}) {
  useUiLanguage();
  const {colors:c} = useTheme();
  const pulse = useRef(new Animated.Value(1)).current;
  const [reduced, setReduced] = useState(true);
  const [pulsating, setPulsating] = useState(false);
  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isReduceMotionEnabled().then(value => {if(active)setReduced(value);}).catch(() => {});
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged',setReduced);
    return () => {active=false;subscription.remove();};
  },[]);
  useEffect(() => {
    pulse.setValue(1);
    setPulsating(false);
    if(!attention || reduced)return;
    setPulsating(true);
    const animation = Animated.loop(Animated.sequence([
      Animated.timing(pulse,{toValue:0.35,duration:650,useNativeDriver:true}),
      Animated.timing(pulse,{toValue:1,duration:650,useNativeDriver:true}),
    ]),{iterations:attention.required ? -1 : 3});
    animation.start(({finished}) => { if (finished) setPulsating(false); });
    return () => {animation.stop();pulse.setValue(1);};
  },[attention?.key,attention?.required,reduced,pulse]);
  const title = cardsTitle ? ui('common.your_cards') : attention ? ui(attention.title) : ui('common.your_cards');
  const detail = attention ? ui(attention.detail) : '';
  const opportunities = attention?.opportunities.filter(key => attention.required || key !== attention.title) || [];
  const inlineMaal = (cardsTitle && (attention?.title==='common.attention_maal' || attention?.opportunities.includes('common.attention_maal'))) || (attention?.title === 'common.attention_turn' && opportunities.includes('common.attention_maal'));
  const body = compact ? <View style={{minHeight:44,justifyContent:'center',borderRadius:radii.large,borderWidth:1,borderColor:attention?c.tableTrim:c.border,backgroundColor:c.tableHeader,paddingHorizontal:30,paddingVertical:6,flexDirection:'row',alignItems:'center',gap:6}}>
    <View style={{flex:1,minWidth:0}}>
      {!compactLabel && !attention && idleContent ? idleContent : <SmallText testID="marriage-header-status" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} accessibilityLiveRegion="polite" style={{fontFamily:fonts.medium,color:attention?c.tableTrim:c.onTableHeader,fontSize:12,textAlign:'center'}}>{compactLabel || `${title}${detail ? ` — ${detail}` : ''}`}</SmallText>}
      {!!attention?.opportunities.length && <SmallText testID="marriage-header-opportunities" style={{fontFamily:fonts.medium,color:c.tableTrim,fontSize:11,textAlign:'center'}}>{attention.opportunities.map(key=>ui(key==='common.attention_marriage'?'marriage.marriage_eligible':key).toLocaleUpperCase()).join(' · ')}</SmallText>}
    </View><View pointerEvents="none" style={{position:'absolute',right:8}}>{endControl}</View>
  </View> : <View style={{flexDirection:'row',alignItems:'center',gap:4,minHeight:64}}>
    <View style={{flex:1,minWidth:0,borderRadius: radii.large,borderWidth:1,borderColor:attention ? c.tableTrim : c.border,backgroundColor:c.tableHeader,paddingHorizontal:12,paddingVertical:9,flexDirection:'row',alignItems:'center',gap:10}}>
      {pulsating && <Animated.View testID="attention-glow" pointerEvents="none" style={{position:'absolute',inset:0,borderRadius: radii.large,borderWidth:3,borderColor:c.tableTrim,opacity:pulse,boxShadow:`0 0 12px ${c.tableTrim}`}} />}
      {!attention && idleContent ? <View style={{flex:1,minWidth:0}}>{idleContent}</View> : <>{!inlineMaal && <View style={{width:24,height:34}}><CardBack /></View>}
      <View style={{flex:1,minWidth:0}}><View style={{flexDirection:'row',alignItems:'baseline',gap:6}}><Text accessibilityLiveRegion="polite" numberOfLines={inlineMaal ? 1 : 2} style={{fontFamily:fonts.medium,color:attention ? c.tableTrim : c.onTableHeader,fontSize:15,flexShrink:1}}>{title}</Text>{inlineMaal && <SmallText testID="inline-maal-eligible" numberOfLines={1} style={{fontFamily:fonts.body,color:c.tableTrim,fontSize:11,flexShrink:1}}>{cardsTitle ? '- ' : ''}{ui('common.attention_maal')}</SmallText>}</View>
        {!!detail && <Text numberOfLines={inlineMaal ? 1 : undefined} adjustsFontSizeToFit={inlineMaal} minimumFontScale={0.85} style={{fontFamily:fonts.body,color:c.onTableHeader,fontSize:12}}>{detail}</Text>}
        {!!opportunities.length && !inlineMaal && <Text numberOfLines={1} style={{color:c.tableTrim,fontSize:11}}>{opportunities.map(key=>ui(key)).join(' · ')}</Text>}
      </View></>}{endControl}
    </View>
  </View>;
  return onPress ? <Pressable testID={expanded ? "hand-attention-expanded" : "hand-attention-collapsed"} accessibilityRole="button" disabled={disabled} accessibilityState={{expanded,disabled}} accessibilityLabel={`${ui(expanded ? "common.collapse_your_card_area" : "common.expand_your_card_area")}. ${compactLabel || title}. ${detail}`} onPress={onPress} style={{flex:1,minWidth:0,opacity:disabled?0.55:1}}>{body}</Pressable> : <View testID="game-attention-expanded" style={{width:'100%',flexShrink:0}}>{body}</View>;
}
