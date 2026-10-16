import { RoomSheet } from './RoomSheet';
import { FormFooter } from './FormFooter';
import {CompactCardFace} from './CompactCardFace';
import {AppText as Text} from './AppText';
import { ui, uiLabel } from '../i18n/copy.ts';
import { useUiLanguage } from '../i18n/useUiLanguage';
import { type RefObject, useEffect, useRef, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import {PanResponder, Pressable, ScrollView, View} from 'react-native';
import { maalOptions, maalRouteOptions, maalChoiceSizes, type MaalOption } from '../multiplayer/maalProgress';
import { canSubmitMarriage, marriageFace, type MarriageCard, type MarriageMeld, type MarriageView } from '../multiplayer/marriage';
import { arrangeMarriageHand, type MarriageArrangement } from '../multiplayer/marriageArrangement';
import { MarriageMeldCards } from './MarriageMeldCards';
import { TurnGlow } from './TurnGlow';
import { visualStates, radii, fonts, gameButtonStyle, useTheme } from '../theme';

export function MarriageMaalPanel({ hand, shown, unlocked, maal, enabled, visible, busy, actions, preview, setPreview, arrangement, error, submit, onEligibility, playerCount, handAnchor }: {
  handAnchor?:RefObject<View|null>; playerCount:number; onEligibility?: (ready:boolean)=>void; hand: MarriageCard[]; shown: MarriageMeld[]; unlocked: boolean; maal: NonNullable<MarriageView['private']>['maal'];
  enabled: boolean; visible: boolean; busy: boolean; actions: string[]; preview: boolean; setPreview: (value:boolean)=>void;
  arrangement: MarriageArrangement; error: string; submit:(command:string,payload:object)=>void;
}) {
  useUiLanguage();
  const {colors:c}=useTheme();
  const key=hand.map(card=>card.card_id).sort().join(',')+'|'+playerCount+'|'+shown.flatMap(g=>g.card_ids).sort().join(',');
  const [result,setResult]=useState<{key:string;choices:MaalOption[]}>({key:'',choices:[]});
  const [page,setPage]=useState(0),[variant,setVariant]=useState(0),[route,setRoute]=useState<'normal'|'dublee'>('normal');
  const submitted=useRef(false);
  const stripGesture=useRef(false);
  useEffect(()=>{
    if(unlocked || !visible) return;
    const task=setTimeout(()=>{setResult({key,choices:maalOptions(hand,playerCount>=4)});setPage(0);setVariant(0);setRoute('normal');},0);
    return ()=>clearTimeout(task);
  },[key,unlocked,visible]);
  useEffect(()=>{if(unlocked && submitted.current){submitted.current=false;setPreview(false);}},[unlocked]);
  const checking=!unlocked && visible && (result.key!==key || busy && actions.includes('draw'));
  const allOptions=result.key===key ? result.choices : [];
  const routes=(['normal','dublee'] as const).filter(value=>allOptions.some(option=>option.choice.route===value));
  const activeRoute=routes.includes(route)?route:routes[0];
  const groupedOptions=maalRouteOptions(allOptions,activeRoute);
  const options=activeRoute==='dublee'?groupedOptions.flatMap(option=>option.variants.map(choice=>({choice,variants:[choice]}))):groupedOptions;
  const index=Math.min(page,Math.max(0,options.length-1)), option=options[index], choice=option?.variants[Math.min(variant,option.variants.length-1)];
  const choosePage=(next:number)=>{setPage(next);setVariant(0);};
  const pageGesture=useRef({blocked:true,index:0,count:0});
  pageGesture.current={blocked:busy||checking,index,count:options.length};
  const pageResponder=useRef(PanResponder.create({
    onMoveShouldSetPanResponderCapture:(_,gesture)=>!stripGesture.current&&!pageGesture.current.blocked&&pageGesture.current.count>1&&Math.abs(gesture.dx)>16&&Math.abs(gesture.dx)>Math.abs(gesture.dy)*1.5,
    onPanResponderRelease:(_,gesture)=>{const current=pageGesture.current;if(!current.blocked&&Math.abs(gesture.dx)>60&&Math.abs(gesture.dx)>Math.abs(gesture.dy)*1.5){setPage(Math.max(0,Math.min(current.count-1,current.index+(gesture.dx<0?1:-1))));setVariant(0);}stripGesture.current=false;},
    onPanResponderTerminate:()=>{stripGesture.current=false;},
  })).current;
  const command=choice ? canSubmitMarriage(choice.groups) : null;
  const canShow=!!command && enabled && !busy && visible && actions.includes(command.toLowerCase());
  const eligible=visible && allOptions.length>0;
  const canPreview=eligible && !checking && !busy;
  useEffect(()=>{onEligibility?.(eligible && !unlocked);},[eligible,unlocked,onEligibility]);
  const text={color:c.text,fontFamily:fonts.body};
  const button=(label:string,onPress:()=>void,disabled=false,primary=false)=><Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{disabled}} disabled={disabled} onPress={onPress}
    style={({pressed})=>({...gameButtonStyle(c,primary?'primary':'secondary',pressed),minHeight:44,alignItems:'center',justifyContent:'center',opacity:disabled?visualStates.disabledOpacity:1})}><Text activity style={{color:primary?c.onPrimary:c.onTableHeader,fontFamily:fonts.medium,textAlign:'center'}}>{label}</Text></Pressable>;
  if (!preview) {
    const label=ui(eligible?'marriage.maal_eligible':'marriage.maal_ineligible');
    const hint=!visible?ui('marriage.reveal_cards_to_check_maal'):checking?ui('marriage.checking_maal'):eligible?ui('marriage.maal_eligible_view_options'):ui('marriage.maal_not_eligible');
    return <View testID="marriage-maal-eligibility" style={{flex:1,minWidth:0,borderRadius: radii.medium,borderWidth:1,borderColor:eligible||unlocked?c.accent:c.border,overflow:'hidden'}}>
      <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityHint={hint} accessibilityState={{disabled:unlocked? !visible : !canPreview}} disabled={unlocked?!visible:!canPreview} onPress={()=>setPreview(true)} style={{minHeight:48,padding:6,flexDirection:'row',alignItems:'center',gap:8,opacity:eligible||unlocked?1:0.5}}>
        <Ionicons name={eligible||unlocked?'bulb':'bulb-outline'} size={16} color={eligible||unlocked?c.accent:c.textMuted}/>
        <Text activity accessibilityLiveRegion="polite" style={{...text,fontSize:11,color:eligible||unlocked?c.accent:c.textMuted,flexShrink:1}}>{label}</Text>
      </Pressable>
      <TurnGlow active={canPreview} radius={12}/>
    </View>;
  }
  const ids=new Set(choice?.groups.flatMap(g=>g.card_ids)||[]);
  const remaining=hand.filter(card=>!ids.has(card.card_id));
  const confirmation=!unlocked && <FormFooter>
    {!!error&&<Text activity accessibilityRole="alert" style={{...text,color:c.danger,textAlign:'center'}}>{uiLabel(error,'feedback')}</Text>}
    {!!choice&&!canShow&&!busy&&<Text style={{...text,color:c.textMuted,textAlign:'center',fontSize:12}}>{ui(actions.includes('draw')?'marriage.you_can_show_after_drawing_on_your_turn':'marriage.show_on_your_turn')}</Text>}
    {button(ui('marriage.confirm_show'),()=>{if(command&&choice&&canShow){submitted.current=true;submit(command,command==='SHOW_DUBLEES'?{pairs:choice.groups}:{melds:choice.groups});}},!canShow||checking,true)}
  </FormFooter>;
  return <RoomSheet centerTitle containedBy={handAnchor} visible={preview} title={ui('marriage.maal_eligibility_title')} onClose={()=>setPreview(false)} closeLabel={ui('common.close_details')} testID="marriage-maal-overlay" scrollable={false} footer={confirmation}>
    <View {...pageResponder.panHandlers} onTouchEnd={()=>{stripGesture.current=false;}} onTouchCancel={()=>{stripGesture.current=false;}} style={{flex:1,minHeight:0}}>
    <ScrollView
      testID="marriage-maal-preview" style={{flex:1,minHeight:0}} contentContainerStyle={{padding:12,gap:6}} keyboardShouldPersistTaps="handled">
    {unlocked && maal ? <>
      <Text style={text}>{ui("marriage.maal")}</Text>
      <Text style={text}>{ui("common.tiplu_tiplu_jhiplu_jhiplu_poplu_poplu", { "tiplu": marriageFace(maal.tiplu), "jhiplu": marriageFace(maal.jhiplu), "poplu": marriageFace(maal.poplu) })}</Text>
    </> : <>
      {routes.length>1 && <View accessibilityRole="tablist" testID="marriage-maal-route-tabs" style={{flexDirection:'row',gap:6}}>{routes.map(value=>{
        const label=ui(value==='normal'?'marriage.sequence_tunnela':'marriage.dublee');
        return <Pressable key={value} accessibilityRole="tab" accessibilityLabel={label} accessibilityState={{selected:activeRoute===value,disabled:busy}} aria-selected={activeRoute===value} disabled={busy} onPress={()=>{setRoute(value);setPage(0);setVariant(0);}} style={{flex:1,minHeight:44,padding:8,borderRadius:10,borderWidth:1,borderColor:activeRoute===value?c.accent:c.border,backgroundColor:activeRoute===value?c.surfaceSelected:c.surface,justifyContent:'center'}}><Text style={{...text,color:activeRoute===value?c.accent:c.text,textAlign:'center'}}>{label}</Text></Pressable>;
      })}</View>}
      {routes.length===1&&<Text testID="marriage-maal-route-caption" style={{...text,fontFamily:fonts.medium,color:c.accent,textAlign:'center'}}>{ui(activeRoute==='dublee'?'marriage.dublee':'marriage.sequence_tunnela')}</Text>}
      <View style={{flexDirection:'row',alignItems:'center',justifyContent:'center',gap:4}}>
        {options.length>1&&<Pressable accessibilityRole="button" accessibilityLabel={ui('marriage.previous_option')} disabled={busy||checking||index===0} onPress={()=>choosePage(index-1)} style={{minWidth:44,minHeight:44,justifyContent:'center',alignItems:'center',opacity:index===0?.4:1}}><Ionicons name="chevron-back" size={22} color={c.accent}/></Pressable>}
        <View style={{flex:1,flexDirection:'row',flexWrap:'wrap',gap:4,justifyContent:'center',alignItems:'center'}}><Text testID="marriage-option-label" accessibilityLiveRegion="polite" style={{...text,fontFamily:fonts.medium,fontSize:13}}>{ui(activeRoute==='dublee'?'marriage.option_pager_label':'marriage.option_compact_label',{number:options.length?index+1:0,total:options.length,sizes:choice?maalChoiceSizes(choice):'—'})}</Text>{activeRoute!=='dublee'&&option&&option.variants.length>1&&<Text testID="marriage-combinations-label" style={{...text,color:c.accent,textAlign:'center',fontSize:12}}>{ui('marriage.combinations_count',{count:option.variants.length})}</Text>}</View>
        {options.length>1&&<Pressable accessibilityRole="button" accessibilityLabel={ui('marriage.next_option')} disabled={busy||checking||index>=options.length-1} onPress={()=>choosePage(index+1)} style={{minWidth:44,minHeight:44,justifyContent:'center',alignItems:'center',opacity:index>=options.length-1?.4:1}}><Ionicons name="chevron-forward" size={22} color={c.accent}/></Pressable>}
      </View>
      {activeRoute!=='dublee'&&option&&option.variants.length>1&&<>
        <ScrollView key={`${activeRoute}:${index}`} horizontal nestedScrollEnabled onTouchStart={()=>{stripGesture.current=true;}} testID="marriage-suboptions" showsHorizontalScrollIndicator contentContainerStyle={{gap:6,paddingBottom:4}}>{option.variants.map((sub,i)=><Pressable key={i} testID={`marriage-suboption-${i}`} accessibilityRole="button" accessibilityState={{selected:i===variant,disabled:busy}} disabled={busy} onPress={()=>setVariant(i)} style={{minHeight:44,paddingHorizontal:10,paddingVertical:5,borderRadius:8,borderWidth:1,borderColor:i===variant?c.accent:c.border,backgroundColor:i===variant?c.surfaceSelected:c.surface,justifyContent:'center'}}><Text style={{...text,fontSize:12,color:i===variant?c.accent:c.text}}>{ui('marriage.suboption_size_label',{number:i+1,sizes:maalChoiceSizes(sub)})}</Text></Pressable>)}</ScrollView>
      </>}
      {choice && <>
        {!!shown.length && <><Text style={text}>{ui("marriage.already_shown")}</Text><MarriageMeldCards hideLabels groups={shown}/></>}
        {choice.route==='normal'?<View testID="marriage-maal-three-groups" style={{gap:8,padding:10,borderWidth:1,borderColor:c.accent,borderRadius:12}}><Text testID="marriage-cards-to-show" style={{...text,textAlign:'center',fontSize:12}}>{ui('marriage.cards_to_show_count',{count:ids.size})}</Text>{choice.groups.map((group,index)=><View key={index} testID={`marriage-maal-group-${index}`} style={{flexDirection:'row',justifyContent:'center',gap:5}}>{group.card_ids.map(id=>{
          const card=hand.find(card=>card.card_id===id)!;
          return <View key={id} accessibilityLabel={id} style={{width:44,height:64,borderRadius:6,borderWidth:1,borderColor:c.cardBorder,backgroundColor:c.cardFace,alignItems:'center',justifyContent:'center'}}><CompactCardFace rank={card.rank} suit={card.suit}/></View>;
        })}</View>)}</View>:<View style={{gap:6}}><Text testID="marriage-cards-to-show" style={{...text,textAlign:'center'}}>{ui('marriage.cards_to_show_count',{count:ids.size})}</Text><MarriageMeldCards hideLabels groups={choice.groups}/></View>}

        <Text style={{...text,textAlign:'center'}}>{ui("marriage.remaining_in_your_hand_count_cards", { "count": remaining.length })}</Text>
        <View testID="marriage-maal-remaining" style={{flexDirection:'row',flexWrap:'wrap',gap:4}}>
          {arrangeMarriageHand(remaining,arrangement).flatMap(group=>group.cards).map(card=><View key={card.card_id} accessibilityLabel={card.card_id} style={{width:40,height:58,alignItems:'center',justifyContent:'center',borderRadius:6,backgroundColor:c.cardFace,borderWidth:1,borderColor:c.cardBorder}}>
            <CompactCardFace rank={card.rank} suit={card.suit} joker={card.card_type === 'man'}/>
          </View>)}
        </View>
      </>}
      {!checking&&!choice&&<Text style={text}>{ui("marriage.your_hand_no_longer_qualifies_go_back_to_your_cards")}</Text>}
    </>}
    </ScrollView></View>
  </RoomSheet>;
}
