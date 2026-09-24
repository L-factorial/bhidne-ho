import { Ionicons } from '@expo/vector-icons';
import { Pressable, Text, View } from 'react-native';
import { HandTrayLabel } from './HandTrayLabel';
import { TurnGlow } from './TurnGlow';
import { fonts, gameButtonStyle, useTheme } from '../theme';

/** Shared collapsed presentation; each game owns its expanded contents. */
export function HandAreaBar({ open, onToggle, count, attention, instruction }: {
  open: boolean; onToggle: () => void; count?: number; attention: boolean; instruction?: string;
}) {
  const { colors } = useTheme();
  return <View style={{flexDirection:'row',alignItems:'center',gap:4,minHeight:open?50:64,backgroundColor:colors.tableHeader,alignSelf:'stretch'}}>
    <View style={{flex:1,minWidth:0,paddingHorizontal:12,paddingVertical:5,gap:2}}>
      <HandTrayLabel count={count}/>
      {!open && attention && !!instruction && <Text accessibilityLiveRegion="polite" numberOfLines={2} style={{fontFamily:fonts.medium,fontSize:12,color:colors.cardInnerBorder}}>{instruction}</Text>}
    </View>
    <Pressable accessibilityRole="button" accessibilityLabel={open?'Collapse your card area':'Expand your card area'}
      accessibilityState={{expanded:open}} onPress={onToggle}
      style={({pressed})=>({...gameButtonStyle(colors,'secondary',pressed),width:44,height:44,marginRight:6,paddingHorizontal:0,alignItems:'center',justifyContent:'center'})}>
      <Ionicons name={open?'chevron-down':'chevron-up'} size={22} color={colors.onTableHeader}/>
    </Pressable>
    <TurnGlow active={attention} radius={10}/>
  </View>;
}
