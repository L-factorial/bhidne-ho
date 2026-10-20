import {AppText as Text} from './AppText';
import { ui } from '../i18n/copy.ts';
import { useUiLanguage } from '../i18n/useUiLanguage';
import { useEffect, useMemo, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import {Pressable, View} from 'react-native';
import { CompactCardFace } from './CompactCardFace';
import { RoomSheet } from './RoomSheet';
import { TurnGlow } from './TurnGlow';
import { visualStates, radii, fonts, gameButtonStyle, useTheme } from '../theme';
import type { MarriageCard, MarriageMeld } from '../multiplayer/marriage';

export function MarriageTunnelaPanel({hand,visible,busy,connected,submit,onEligibility}: {
  onEligibility?: (ready:boolean)=>void; hand:MarriageCard[];visible:boolean;busy:boolean;connected:boolean;
  submit:(command:string,payload:object)=>void;
}) {
  const uiLanguage = useUiLanguage();
  const {colors:c}=useTheme();
  const groups=useMemo(()=>{
    const faces=new Map<string,MarriageCard[]>();
    for(const card of hand) if(card.card_type==='standard') {
      const key=`${card.rank}:${card.suit}`;
      faces.set(key,[...(faces.get(key)||[]),card]);
    }
    return [...faces.values()].filter(cards=>cards.length===3).map(cards=>({meld_type:"tunnela" as const,card_ids:cards.map(card=>card.card_id)}));
  },[hand.map(card=>card.card_id).join(','), uiLanguage]);
  const [preview,setPreview]=useState(false);
  const [selected,setSelected]=useState<string[]>([]);
  const enabled=visible&&!busy&&connected;
  useEffect(()=>{onEligibility?.(visible && groups.length>0);},[visible,groups,onEligibility]);
  const send=(melds:MarriageMeld[])=>submit('DECLARE_TUNNELAS',{melds});
  const button=(label:string,action:()=>void,disabled=false,primary=false)=><Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{disabled}} disabled={disabled} onPress={action}
    style={({pressed})=>({...gameButtonStyle(c,primary?'primary':'secondary',pressed),minHeight:44,justifyContent:'center',opacity:disabled?visualStates.disabledOpacity:1})}><Text style={{color:primary?c.onPrimary:c.onTableHeader,fontFamily:fonts.medium}}>{label}</Text></Pressable>;
  const overlay=<RoomSheet visible={preview&&visible} title={ui("marriage.choose_tunnelas_to_show")} presentation="dialog"
    onClose={()=>setPreview(false)} testID="marriage-tunnela-preview" footer={<View style={{padding:12,gap:8}}>
      {button(busy?ui("marriage.recording_declaration"):ui("marriage.show_selected_tunnelas"),()=>send(groups.filter(g=>selected.includes(g.card_ids[0]))),!enabled||!selected.length,true)}
      {button(ui("marriage.declare_no_tunnela"),()=>send([]),!enabled)}
    </View>}>
    <View style={{flexDirection:'row',flexWrap:'wrap',justifyContent:'center',gap:8}}>
    {groups.map((group,i)=>{
      const key=group.card_ids[0],checked=selected.includes(key);
      return <Pressable key={key} accessibilityRole="checkbox" aria-checked={checked} accessibilityLabel={ui("marriage.tunnela_number", { "number": i+1 })} accessibilityState={{checked,disabled:busy}} disabled={busy}
        onPress={()=>setSelected(ids=>checked?ids.filter(id=>id!==key):[...ids,key])}
        style={{width:140,padding:8,paddingTop:24,borderWidth:2,borderRadius:radii.medium,borderColor:checked?c.accent:c.border,backgroundColor:checked?c.surfaceSelected:c.surface}}>
        {checked&&<Ionicons name="checkmark" size={18} color={c.accent} style={{position:'absolute',right:4,top:2}}/>}
        <View style={{flexDirection:'row',justifyContent:'center',gap:3}}>{group.card_ids.map(id=>{
          const card=hand.find(card=>card.card_id===id)!;
          return <View key={id} style={{width:36,height:52,borderRadius:5,borderWidth:1,borderColor:c.cardBorder,backgroundColor:c.cardFace,alignItems:'center',justifyContent:'center'}}><CompactCardFace rank={card.rank} suit={card.suit}/></View>;
        })}</View>
      </Pressable>;
    })}
    </View>
  </RoomSheet>;
  const label=!visible?ui("marriage.reveal_cards_to_check_tunnela"):groups.length?ui("marriage.tunnela_detected_choose_to_show"):ui("marriage.no_tunnela_declare_none");
  return <><View testID="marriage-tunnela-detector" style={{borderWidth:1,borderColor:enabled?c.accent:c.border,borderRadius: radii.medium,overflow:'hidden'}}>
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{disabled:!enabled}} disabled={!enabled}
      onPress={()=>{if(groups.length){setSelected(groups.map(g=>g.card_ids[0]));setPreview(true);}else send([]);}}
      style={{minHeight:52,padding:10,flexDirection:'row',alignItems:'center',gap:8,opacity:enabled?1:visualStates.disabledOpacity}}>
      <Ionicons name={enabled?'bulb':'bulb-outline'} size={22} color={enabled?c.accent:c.textMuted}/>
      <Text style={{color:enabled?c.accent:c.textMuted,fontFamily:fonts.medium,flexShrink:1}}>{busy?ui("marriage.recording_declaration"):label}</Text>
    </Pressable><TurnGlow active={enabled} radius={12}/>
  </View>{overlay}</>;
}
