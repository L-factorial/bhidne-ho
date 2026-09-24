import { ui } from '../i18n/copy.ts';
import { useUiLanguage } from '../i18n/useUiLanguage';
import { Ionicons } from '@expo/vector-icons';
import { Pressable, Text, View } from 'react-native';
import { HandTrayLabel } from './HandTrayLabel';
import { TurnGlow } from './TurnGlow';
import { fonts, gameButtonStyle, useTheme } from '../theme';

/** Shared collapsed presentation; each game owns its expanded contents. */
export function HandAreaBar({ open, onToggle, count, attention, instruction }: {
  open: boolean; onToggle: () => void; count?: number; attention: boolean; instruction?: string;
}) {
  useUiLanguage();
  const { colors } = useTheme();
  const label = <View style={{flex:1,minWidth:0,paddingHorizontal:12,paddingVertical:5,gap:2}}>
    <HandTrayLabel count={count}/>
    {attention && !!instruction && <Text testID="hand-action-instruction" accessibilityLiveRegion="polite" numberOfLines={2} style={{fontFamily:fonts.medium,fontSize:12,color:colors.cardInnerBorder}}>{instruction}</Text>}
  </View>;
  const chevron = <Ionicons name={open?'chevron-down':'chevron-up'} size={22} color={colors.onTableHeader}/>;
  const buttonStyle = {...gameButtonStyle(colors,'secondary',false),width:44,height:44,marginRight:6,paddingHorizontal:0,alignItems:'center' as const,justifyContent:'center' as const};
  const barStyle = {flexDirection:'row' as const,alignItems:'center' as const,gap:4,minHeight:open && !attention?50:64,backgroundColor:colors.tableHeader,alignSelf:'stretch' as const};
  if (!open) return <Pressable accessibilityRole="button" accessibilityLabel={ui("common.expand_your_card_area")} accessibilityState={{expanded:false}} onPress={onToggle} style={barStyle}>
    {label}<View style={buttonStyle}>{chevron}</View><TurnGlow active={attention} radius={10}/>
  </Pressable>;
  return <View style={barStyle}>{label}
    <Pressable accessibilityRole="button" accessibilityLabel={ui("common.collapse_your_card_area")} accessibilityState={{expanded:true}} onPress={onToggle} style={buttonStyle}>{chevron}</Pressable>
    <TurnGlow active={attention} radius={10}/>
  </View>;
}
