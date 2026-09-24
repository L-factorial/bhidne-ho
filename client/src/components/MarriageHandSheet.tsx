import { HandAreaBar } from './HandAreaBar';
import { useSocialHandAnchor } from './TableSocial';
import type { ReactNode, RefObject } from 'react';
import { ScrollView, View } from 'react-native';
import type { HandSnap } from '../multiplayer/marriageWorkspace';
import { useTheme } from '../theme';

export function MarriageHandSheet({ mobile, anchor, snap, onSnap, instruction, attention, header, footer, children, cardCount }: {
  cardCount: number; anchor: RefObject<View | null>;
  mobile: boolean; snap: HandSnap; onSnap: (snap: HandSnap) => void;
  instruction: string; attention: boolean; header: ReactNode; footer?: ReactNode; children: ReactNode;
}) {
  const socialAnchor = useSocialHandAnchor(anchor);
  const { colors } = useTheme();
  const open = snap !== 'collapsed';
  const controls = <HandAreaBar open={open} onToggle={() => onSnap(open?'collapsed':'expanded')} count={cardCount} attention={attention} instruction={instruction}/>;
  // RoomGameControl already keeps this whole sheet inside the device safe area.
  // This footer takes layout space; it never floats over the final row of cards.
  const actionFooter = footer ? <View testID="marriage-hand-footer" style={{ flexShrink: 0,
    borderTopWidth: 1, borderColor: colors.tableTrim, padding: 10, paddingBottom: 12, gap: 6 }}>{footer}</View> : null;
  if (!mobile) return <View onLayout={socialAnchor.onLayout} ref={anchor} style={{ maxHeight: '60%', minHeight: 0 }}>{controls}<View style={{display:open?'flex':'none',minHeight:0,flexShrink:1}} accessibilityElementsHidden={!open} importantForAccessibility={open?'auto':'no-hide-descendants'}>{header}
    <ScrollView style={{ minHeight: 0 }} contentContainerStyle={{ paddingBottom: 16 }}>{children}</ScrollView>{actionFooter}</View></View>;
  return <View onLayout={socialAnchor.onLayout} ref={anchor} testID="marriage-mobile-hand" style={{ position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 30,
    height: open ? '74%' : 82,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.tableTrim,
    borderTopLeftRadius: 20, borderTopRightRadius: 20, overflow: 'hidden' }}>
    <View style={{ alignSelf: 'center', marginTop: 5, width: 36, height: 3, borderRadius: 2, backgroundColor: colors.tableTrim }} />
    {controls}
    <View style={{ flex: 1, minHeight: 0, display: open ? 'flex' : 'none' }} accessibilityElementsHidden={!open} importantForAccessibility={open ? 'auto' : 'no-hide-descendants'}>
      {header}
      <ScrollView testID="marriage-hand-content" style={{ flex: 1, minHeight: 0 }} nestedScrollEnabled contentContainerStyle={{ paddingBottom: 16 }}>{children}</ScrollView>
      {actionFooter}
    </View>
  </View>;
}
