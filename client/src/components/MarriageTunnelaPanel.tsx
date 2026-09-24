import { useMemo, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { Pressable, Text, View } from 'react-native';
import { MarriageMeldCards } from './MarriageMeldCards';
import { TurnGlow } from './TurnGlow';
import { fonts, gameButtonStyle, useTheme } from '../theme';
import type { MarriageCard, MarriageMeld } from '../multiplayer/marriage';

export function MarriageTunnelaPanel({hand,visible,busy,connected,submit}: {
  hand:MarriageCard[];visible:boolean;busy:boolean;connected:boolean;
  submit:(command:string,payload:object)=>void;
}) {
  const {colors:c}=useTheme();
  const groups=useMemo(()=>{
    const faces=new Map<string,MarriageCard[]>();
    for(const card of hand) if(card.card_type==='standard') {
      const key=`${card.rank}:${card.suit}`;
      faces.set(key,[...(faces.get(key)||[]),card]);
    }
    return [...faces.values()].filter(cards=>cards.length===3).map(cards=>({meld_type:'tunnela' as const,card_ids:cards.map(card=>card.card_id)}));
  },[hand.map(card=>card.card_id).join(',')]);
  const [preview,setPreview]=useState(false);
  const [selected,setSelected]=useState<string[]>([]);
  const enabled=visible&&!busy&&connected;
  const send=(melds:MarriageMeld[])=>submit('DECLARE_TUNNELAS',{melds});
  const button=(label:string,action:()=>void,disabled=false,primary=false)=><Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{disabled}} disabled={disabled} onPress={action}
    style={({pressed})=>({...gameButtonStyle(c,primary?'primary':'secondary',pressed),minHeight:44,justifyContent:'center',opacity:disabled?0.45:1})}><Text style={{color:primary?c.onPrimary:c.onTableHeader,fontFamily:fonts.medium}}>{label}</Text></Pressable>;
  if(preview&&visible) return <View testID="marriage-tunnela-preview" style={{gap:12}}>
    {button('Back to your cards',()=>setPreview(false),busy)}
    <Text style={{color:c.text,fontFamily:fonts.medium}}>Choose Tunnelas to show</Text>
    {groups.map((group,i)=>{
      const key=group.card_ids[0],checked=selected.includes(key);
      return <Pressable key={key} accessibilityRole="checkbox" aria-checked={checked} accessibilityLabel={`Tunnela ${i+1}`} accessibilityState={{checked,disabled:busy}} disabled={busy}
        onPress={()=>setSelected(ids=>checked?ids.filter(id=>id!==key):[...ids,key])}
        style={{padding:10,gap:6,borderWidth:2,borderRadius:12,borderColor:checked?c.accent:c.border,backgroundColor:checked?c.surfaceSelected:c.surface}}>
        <Text style={{color:c.text}}>{checked?'✓ Selected':'Tap to select'}</Text><MarriageMeldCards groups={[group]}/>
      </Pressable>;
    })}
    {button(busy?'Showing…':'Show selected Tunnelas',()=>send(groups.filter(g=>selected.includes(g.card_ids[0]))),!enabled||!selected.length,true)}
    {button('Declare no Tunnela',()=>send([]),!enabled)}
    <Text style={{color:c.textMuted}}>Only shown Tunnelas qualify for the initial declaration bonus. This does not unlock Maal.</Text>
  </View>;
  const label=!visible?'Reveal cards to check Tunnela':groups.length?'Tunnela detected · Choose to show':'No Tunnela · Declare none';
  return <View testID="marriage-tunnela-detector" style={{borderWidth:1,borderColor:enabled?c.accent:c.border,borderRadius:12,overflow:'hidden'}}>
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{disabled:!enabled}} disabled={!enabled}
      onPress={()=>{if(groups.length){setSelected(groups.map(g=>g.card_ids[0]));setPreview(true);}else send([]);}}
      style={{minHeight:52,padding:10,flexDirection:'row',alignItems:'center',gap:8,opacity:enabled?1:0.5}}>
      <Ionicons name={enabled?'bulb':'bulb-outline'} size={22} color={enabled?c.accent:c.textMuted}/>
      <Text style={{color:enabled?c.accent:c.textMuted,fontFamily:fonts.medium,flexShrink:1}}>{busy?'Recording declaration…':label}</Text>
    </Pressable><TurnGlow active={enabled} radius={12}/>
  </View>;
}
