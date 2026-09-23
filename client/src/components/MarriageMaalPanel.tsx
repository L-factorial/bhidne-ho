import { useEffect, useRef, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { Pressable, Text, View } from 'react-native';
import { maalChoices, type MaalChoice } from '../multiplayer/maalProgress';
import { canSubmitMarriage, marriageFace, type MarriageCard, type MarriageMeld, type MarriageView } from '../multiplayer/marriage';
import { arrangeMarriageHand, type MarriageArrangement } from '../multiplayer/marriageArrangement';
import { MarriageMeldCards } from './MarriageMeldCards';
import { TurnGlow } from './TurnGlow';
import { fonts, gameButtonStyle, useTheme } from '../theme';

export function MarriageMaalPanel({ hand, shown, unlocked, maal, enabled, visible, busy, actions, preview, setPreview, arrangement, error, submit }: {
  hand: MarriageCard[]; shown: MarriageMeld[]; unlocked: boolean; maal: NonNullable<MarriageView['private']>['maal'];
  enabled: boolean; visible: boolean; busy: boolean; actions: string[]; preview: boolean; setPreview: (value:boolean)=>void;
  arrangement: MarriageArrangement; error: string; submit:(command:string,payload:object)=>void;
}) {
  const {colors:c}=useTheme();
  const key=hand.map(card=>card.card_id).sort().join(',')+'|'+shown.flatMap(g=>g.card_ids).sort().join(',');
  const [result,setResult]=useState<{key:string;choices:MaalChoice[]}>({key:'',choices:[]});
  const [page,setPage]=useState(0);
  const submitted=useRef(false), touch=useRef({x:0,y:0});
  useEffect(()=>{
    if(unlocked || !visible) return;
    const task=setTimeout(()=>{setResult({key,choices:maalChoices(hand)});setPage(0);},0);
    return ()=>clearTimeout(task);
  },[key,unlocked,visible]);
  useEffect(()=>{if(unlocked && submitted.current){submitted.current=false;setPreview(false);}},[unlocked]);
  const checking=!unlocked && visible && (result.key!==key || busy && actions.includes('draw'));
  const options=result.key===key ? result.choices : [];
  const index=Math.min(page,Math.max(0,options.length-1)), choice=options[index];
  const command=choice ? canSubmitMarriage(choice.groups) : null;
  const canShow=!!command && enabled && !busy && visible && actions.includes(command.toLowerCase());
  const eligible=visible && options.length>0;
  const text={color:c.text,fontFamily:fonts.body};
  const button=(label:string,onPress:()=>void,disabled=false,primary=false)=><Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{disabled}} disabled={disabled} onPress={onPress}
    style={({pressed})=>({...gameButtonStyle(c,primary?'primary':'secondary',pressed),minHeight:44,justifyContent:'center',opacity:disabled?0.45:1})}><Text style={{color:primary?c.onPrimary:c.onTableHeader,fontFamily:fonts.medium}}>{label}</Text></Pressable>;
  if (!preview) {
    const label=unlocked?'View Maal':!visible?'Reveal cards to check Maal':checking?'Checking Maal…':eligible?(canShow?'Maal eligible · Show for Maal':'Maal eligible · Wait for your turn'):'Maal not eligible';
    return <View testID="marriage-maal-eligibility" style={{borderRadius:12,borderWidth:1,borderColor:eligible||unlocked?c.accent:c.border,overflow:'hidden'}}>
      <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{disabled:unlocked? !visible : !canShow || checking}} disabled={unlocked?!visible:!canShow||checking} onPress={()=>setPreview(true)} style={{minHeight:48,padding:10,flexDirection:'row',alignItems:'center',gap:8,opacity:eligible||unlocked?1:0.5}}>
        <Ionicons name={eligible||unlocked?'bulb':'bulb-outline'} size={22} color={eligible||unlocked?c.accent:c.textMuted}/>
        <Text accessibilityLiveRegion="polite" style={{...text,color:eligible||unlocked?c.accent:c.textMuted,flexShrink:1}}>{label}</Text>
      </Pressable>
      <TurnGlow active={eligible && canShow} radius={12}/>
    </View>;
  }
  const ids=new Set(choice?.groups.flatMap(g=>g.card_ids)||[]);
  const remaining=hand.filter(card=>!ids.has(card.card_id));
  return <View testID="marriage-maal-preview" style={{gap:12}}
    onTouchStart={e=>{touch.current={x:e.nativeEvent.pageX,y:e.nativeEvent.pageY};}}
    onTouchEnd={e=>{const dx=e.nativeEvent.pageX-touch.current.x,dy=e.nativeEvent.pageY-touch.current.y;if(!busy&&Math.abs(dx)>60&&Math.abs(dx)>Math.abs(dy)*1.5)setPage(Math.max(0,Math.min(options.length-1,index+(dx<0?1:-1))));}}>
    {button('Back to your cards',()=>setPreview(false))}
    {unlocked && maal ? <>
      <Text style={text}>Maal</Text>
      <Text style={text}>Tiplu {marriageFace(maal.tiplu)} · Jhiplu {marriageFace(maal.jhiplu)} · Poplu {marriageFace(maal.poplu)}</Text>
    </> : <>
      <View style={{flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:8}}>
        {button('Previous option',()=>setPage(index-1),busy||checking||index===0)}
        <Text accessibilityLiveRegion="polite" style={text}>{checking?'Checking Maal…':`Option ${options.length?index+1:0} of ${options.length}`}</Text>
        {button('Next option',()=>setPage(index+1),busy||checking||index>=options.length-1)}
      </View>
      {choice && <>
        <Text style={{...text,color:c.accent}}>{choice.route==='normal'?'Sequence / Tunnela':'Seven Dublees'}</Text>
        {!!shown.length && <><Text style={text}>Already shown</Text><MarriageMeldCards groups={shown}/></>}
        <Text style={text}>Cards to show · {ids.size}</Text>
        <MarriageMeldCards groups={choice.groups}/>
        <Text style={text}>Remaining in your hand · {remaining.length} cards</Text>
        <View testID="marriage-maal-remaining" style={{gap:8}}>
          {arrangeMarriageHand(remaining,arrangement).map(group=><View key={group.cards[0].card_id} style={{gap:4}}>
            <Text style={{...text,color:c.textMuted}}>{group.label}</Text>
            <View style={{flexDirection:'row',flexWrap:'wrap',gap:4}}>{group.cards.map(card=><View key={card.card_id} accessibilityLabel={card.card_id} style={{padding:8,borderRadius:6,backgroundColor:c.cardFace,borderWidth:1,borderColor:c.cardBorder}}>
              <Text style={{color:card.suit==='H'||card.suit==='D'?c.cardRed:c.cardInk}}>{marriageFace(card)}</Text>
            </View>)}</View>
          </View>)}
        </View>
      </>}
      {!checking&&!choice&&<Text style={text}>Your hand no longer qualifies. Go back to your cards.</Text>}
      {!!error&&<Text accessibilityRole="alert" style={{color:c.danger}}>{error}</Text>}
      {button(busy?'Showing…':'Confirm & show',()=>{if(command&&choice&&canShow){submitted.current=true;submit(command,command==='SHOW_DUBLEES'?{pairs:choice.groups}:{melds:choice.groups});}},!canShow||checking,true)}
      {!!choice&&!canShow&&!busy&&<Text style={{...text,color:c.textMuted}}>You can show after drawing on your turn.</Text>}
    </>}
  </View>;
}
