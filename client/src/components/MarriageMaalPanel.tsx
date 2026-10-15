import {CompactCardFace} from './CompactCardFace';
import {AppText as Text} from './AppText';
import { ui, uiLabel } from '../i18n/copy.ts';
import { useUiLanguage } from '../i18n/useUiLanguage';
import { useEffect, useRef, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import {Pressable, ScrollView, View} from 'react-native';
import { maalOptions, maalChoiceSizes, type MaalOption } from '../multiplayer/maalProgress';
import { canSubmitMarriage, marriageFace, type MarriageCard, type MarriageMeld, type MarriageView } from '../multiplayer/marriage';
import { arrangeMarriageHand, type MarriageArrangement } from '../multiplayer/marriageArrangement';
import { MarriageMeldCards } from './MarriageMeldCards';
import { TurnGlow } from './TurnGlow';
import { visualStates, radii, fonts, gameButtonStyle, useTheme } from '../theme';

export function MarriageMaalPanel({ hand, shown, unlocked, maal, enabled, visible, busy, actions, preview, setPreview, arrangement, error, submit, onEligibility, playerCount }: {
  playerCount:number; onEligibility?: (ready:boolean)=>void; hand: MarriageCard[]; shown: MarriageMeld[]; unlocked: boolean; maal: NonNullable<MarriageView['private']>['maal'];
  enabled: boolean; visible: boolean; busy: boolean; actions: string[]; preview: boolean; setPreview: (value:boolean)=>void;
  arrangement: MarriageArrangement; error: string; submit:(command:string,payload:object)=>void;
}) {
  useUiLanguage();
  const {colors:c}=useTheme();
  const key=hand.map(card=>card.card_id).sort().join(',')+'|'+playerCount+'|'+shown.flatMap(g=>g.card_ids).sort().join(',');
  const [result,setResult]=useState<{key:string;choices:MaalOption[]}>({key:'',choices:[]});
  const [page,setPage]=useState(0),[variant,setVariant]=useState(0),[expanded,setExpanded]=useState(false);
  const submitted=useRef(false), touch=useRef({x:0,y:0});
  useEffect(()=>{
    if(unlocked || !visible) return;
    const task=setTimeout(()=>{setResult({key,choices:maalOptions(hand,playerCount>=4)});setPage(0);setVariant(0);setExpanded(false);},0);
    return ()=>clearTimeout(task);
  },[key,unlocked,visible]);
  useEffect(()=>{if(unlocked && submitted.current){submitted.current=false;setPreview(false);}},[unlocked]);
  const checking=!unlocked && visible && (result.key!==key || busy && actions.includes('draw'));
  const options=result.key===key ? result.choices : [];
  const index=Math.min(page,Math.max(0,options.length-1)), option=options[index], choice=option?.variants[Math.min(variant,option.variants.length-1)];
  const choosePage=(next:number)=>{setPage(next);setVariant(0);setExpanded(false);};
  const command=choice ? canSubmitMarriage(choice.groups) : null;
  const canShow=!!command && enabled && !busy && visible && actions.includes(command.toLowerCase());
  const eligible=visible && options.length>0;
  const canPreview=eligible && !checking && !busy;
  useEffect(()=>{onEligibility?.(eligible && !unlocked);},[eligible,unlocked,onEligibility]);
  const text={color:c.text,fontFamily:fonts.body};
  const button=(label:string,onPress:()=>void,disabled=false,primary=false)=><Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{disabled}} disabled={disabled} onPress={onPress}
    style={({pressed})=>({...gameButtonStyle(c,primary?'primary':'secondary',pressed),minHeight:44,justifyContent:'center',opacity:disabled?visualStates.disabledOpacity:1})}><Text activity style={{color:primary?c.onPrimary:c.onTableHeader,fontFamily:fonts.medium}}>{label}</Text></Pressable>;
  if (!preview) {
    const label=unlocked?ui("marriage.view_maal"):!visible?ui("marriage.reveal_cards_to_check_maal"):checking?ui("marriage.checking_maal"):eligible?(!canShow&&actions.includes('draw')?ui("marriage.maal_eligible_draw_first"):canShow?ui("marriage.maal_eligible_show_for_maal"):ui("marriage.maal_eligible_view_options")):ui("marriage.maal_not_eligible");
    return <View testID="marriage-maal-eligibility" style={{borderRadius: radii.medium,borderWidth:1,borderColor:eligible||unlocked?c.accent:c.border,overflow:'hidden'}}>
      <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{disabled:unlocked? !visible : !canPreview}} disabled={unlocked?!visible:!canPreview} onPress={()=>setPreview(true)} style={{minHeight:48,padding:6,flexDirection:'row',alignItems:'center',gap:8,opacity:eligible||unlocked?1:0.5}}>
        <Ionicons name={eligible||unlocked?'bulb':'bulb-outline'} size={16} color={eligible||unlocked?c.accent:c.textMuted}/>
        <Text activity accessibilityLiveRegion="polite" style={{...text,fontSize:11,color:eligible||unlocked?c.accent:c.textMuted,flexShrink:1}}>{label}</Text>
      </Pressable>
      <TurnGlow active={canPreview} radius={12}/>
    </View>;
  }
  const ids=new Set(choice?.groups.flatMap(g=>g.card_ids)||[]);
  const remaining=hand.filter(card=>!ids.has(card.card_id));
  return <View testID="marriage-maal-preview" style={{gap:6}}
    onTouchStart={e=>{touch.current={x:e.nativeEvent.pageX,y:e.nativeEvent.pageY};}}
    onTouchEnd={e=>{const dx=e.nativeEvent.pageX-touch.current.x,dy=e.nativeEvent.pageY-touch.current.y;if(!busy&&!expanded&&Math.abs(dx)>60&&Math.abs(dx)>Math.abs(dy)*1.5)choosePage(Math.max(0,Math.min(options.length-1,index+(dx<0?1:-1))));}}>
    <Pressable accessibilityRole="button" accessibilityLabel={ui('common.back_to_your_cards')} onPress={()=>setPreview(false)} style={({pressed})=>({...gameButtonStyle(c,'primary',pressed),alignSelf:'center',minHeight:44,paddingHorizontal:18,paddingVertical:6,flexDirection:'row',alignItems:'center',gap:6})}><Ionicons name="arrow-back" size={17} color={c.onPrimary}/><Text style={{color:c.onPrimary,fontFamily:fonts.medium,fontSize:13}}>{ui('common.back_to_your_cards')}</Text></Pressable>
    {unlocked && maal ? <>
      <Text style={text}>{ui("marriage.maal")}</Text>
      <Text style={text}>{ui("common.tiplu_tiplu_jhiplu_jhiplu_poplu_poplu", { "tiplu": marriageFace(maal.tiplu), "jhiplu": marriageFace(maal.jhiplu), "poplu": marriageFace(maal.poplu) })}</Text>
    </> : <>
      <View style={{flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:8}}>
        <Pressable accessibilityRole="button" accessibilityLabel={ui('marriage.previous_option')} disabled={busy||checking||index===0} onPress={()=>choosePage(index-1)} style={{minWidth:44,minHeight:44,justifyContent:'center',alignItems:'center',opacity:index===0?.4:1}}><Ionicons name="chevron-back" size={22} color={c.accent}/></Pressable>
        <View style={{flex:1,alignItems:'center'}}><Text testID="marriage-option-label" accessibilityLiveRegion="polite" style={{...text,fontFamily:fonts.medium,fontSize:13}}>{ui('marriage.option_compact_label',{number:options.length?index+1:0,total:options.length,sizes:choice?maalChoiceSizes(choice):'—'})}</Text></View>
        <Pressable accessibilityRole="button" accessibilityLabel={ui('marriage.next_option')} disabled={busy||checking||index>=options.length-1} onPress={()=>choosePage(index+1)} style={{minWidth:44,minHeight:44,justifyContent:'center',alignItems:'center',opacity:index>=options.length-1?.4:1}}><Ionicons name="chevron-forward" size={22} color={c.accent}/></Pressable>
      </View>
      {option&&option.variants.length>1&&<>
        <Pressable testID="marriage-suboptions-toggle" accessibilityRole="button" accessibilityState={{expanded}} accessibilityLabel={ui('marriage.combinations_count',{count:option.variants.length})} onPress={()=>setExpanded(value=>!value)} style={{minHeight:44,flexDirection:'row',alignItems:'center',justifyContent:'space-between'}}><Text style={{...text,color:c.accent,fontSize:12}}>{ui('marriage.combinations_count',{count:option.variants.length})}</Text><Ionicons name={expanded?'chevron-up':'chevron-down'} size={18} color={c.accent}/></Pressable>
        {expanded&&<ScrollView horizontal testID="marriage-suboptions" showsHorizontalScrollIndicator contentContainerStyle={{gap:4,paddingBottom:0}}>{option.variants.map((sub,i)=><Pressable key={i} testID={`marriage-suboption-${i}`} accessibilityRole="button" accessibilityState={{selected:i===variant}} disabled={busy} onPress={()=>setVariant(i)} style={{minHeight:44,paddingHorizontal:7,paddingVertical:3,borderRadius:8,borderWidth:1,borderColor:i===variant?c.accent:c.border,backgroundColor:i===variant?c.surfaceSelected:c.surface,justifyContent:'center'}}><Text style={{...text,fontSize:12}}>{ui('marriage.suboption_size_label',{number:i+1,sizes:maalChoiceSizes(sub)})}</Text></Pressable>)}</ScrollView>}
      </>}
      {choice && <>
        {!!shown.length && <><Text style={text}>{ui("marriage.already_shown")}</Text><MarriageMeldCards hideLabels groups={shown}/></>}
        <Text style={text}>{ui("marriage.cards_to_show_count", { "count": ids.size })}</Text>
        <MarriageMeldCards hideLabels groups={choice.groups}/>
        <Text style={text}>{ui("marriage.remaining_in_your_hand_count_cards", { "count": remaining.length })}</Text>
        <View testID="marriage-maal-remaining" style={{flexDirection:'row',flexWrap:'wrap',gap:4}}>
          {arrangeMarriageHand(remaining,arrangement).flatMap(group=>group.cards).map(card=><View key={card.card_id} accessibilityLabel={card.card_id} style={{padding:8,borderRadius:6,backgroundColor:c.cardFace,borderWidth:1,borderColor:c.cardBorder}}>
            <CompactCardFace rank={card.rank} suit={card.suit} joker={card.card_type === 'man'}/>
          </View>)}
        </View>
      </>}
      {!checking&&!choice&&<Text style={text}>{ui("marriage.your_hand_no_longer_qualifies_go_back_to_your_cards")}</Text>}
      {!!error&&<Text activity accessibilityRole="alert" style={{color:c.danger}}>{uiLabel(error, 'feedback')}</Text>}
      {button(ui("marriage.confirm_show"),()=>{if(command&&choice&&canShow){submitted.current=true;submit(command,command==='SHOW_DUBLEES'?{pairs:choice.groups}:{melds:choice.groups});}},!canShow||checking,true)}
      {!!choice&&!canShow&&!busy&&<Text style={{...text,color:c.textMuted}}>{ui(actions.includes('draw')?'marriage.you_can_show_after_drawing_on_your_turn':'marriage.show_on_your_turn')}</Text>}
    </>}
  </View>;
}
