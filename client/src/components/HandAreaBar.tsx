import { useEffect } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { View } from 'react-native';
import { HandTrayLabel } from './HandTrayLabel';
import { GameAttentionBanner } from './GameAttentionBanner';
import { TableSocialButton, useTableSocial } from './TableSocial';
import type { GameAttention } from '../notifications/gameAttention';
import { useTheme } from '../theme';

/** The hand header owns cues in both positions; cards and inner cues stay intact. */
export function HandAreaBar({ open, onToggle, count, cue = null, disabled = false }: {
  open: boolean; onToggle: () => void; count?: number; cue?: GameAttention|null; disabled?: boolean;
  attention?: boolean; instruction?: string;
}) {
  const { colors } = useTheme(), social = useTableSocial();
  const setHandCollapsed = social?.setHandCollapsed;
  useEffect(() => {
    setHandCollapsed?.(true);
    return () => setHandCollapsed?.(false);
  }, [setHandCollapsed]);
  return <View testID="hand-area-header" style={{flexDirection:'row',alignItems:'center',minHeight:80,backgroundColor:colors.tableHeader,alignSelf:'stretch'}}>
    <TableSocialButton kind="chat" />
    <GameAttentionBanner attention={cue} expanded={open} disabled={disabled} onPress={onToggle}
      idleContent={<HandTrayLabel count={count}/>} endControl={<Ionicons name={open?'chevron-down':'chevron-up'} size={20} color={colors.onTableHeader}/>}/>
    <TableSocialButton kind="poke" />
  </View>;
}
