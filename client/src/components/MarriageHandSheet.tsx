import type { ReactNode, RefObject } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import type { HandSnap } from '../multiplayer/marriageWorkspace';
import { fonts, useTheme } from '../theme';

export function MarriageHandSheet({ mobile, anchor, snap, onSnap, instruction, attention, header, footer, children }: {
  anchor: RefObject<View | null>;
  mobile: boolean; snap: HandSnap; onSnap: (snap: HandSnap) => void;
  instruction: string; attention: boolean; header: ReactNode; footer?: ReactNode; children: ReactNode;
}) {
  const { colors } = useTheme();
  const open = snap !== 'collapsed';
  const controls = <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
    <Pressable accessibilityRole="button" accessibilityLabel={open ? 'Collapse your card area' : 'Expand your card area'}
      accessibilityState={{ expanded: open }} onPress={() => onSnap(open ? 'collapsed' : 'expanded')}
      style={{ flex: 1, minHeight: 54, paddingHorizontal: 12, justifyContent: 'center', backgroundColor: attention ? colors.turnSurface : colors.surface }}>
      <Text accessibilityLiveRegion="polite" style={{ fontFamily: fonts.medium, fontSize: 14, color: attention ? colors.turnText : colors.text }}>{instruction}</Text>
    </Pressable>
    {(['peek', 'expanded'] as const).map(value => <Pressable key={value} accessibilityRole="button"
      accessibilityLabel={value === 'peek' ? 'Peek at your hand' : 'Expand full hand'} accessibilityState={{ selected: snap === value }}
      onPress={() => onSnap(value)} style={{ minHeight: 44, minWidth: 44, paddingHorizontal: 8, justifyContent: 'center' }}>
      <Text style={{ fontFamily: fonts.body, fontSize: 12, color: snap === value ? colors.accent : colors.textMuted }}>{value === 'peek' ? 'Peek' : 'Full'}</Text>
    </Pressable>)}
  </View>;
  // RoomGameControl already keeps this whole sheet inside the device safe area.
  // This footer takes layout space; it never floats over the final row of cards.
  const actionFooter = footer ? <View testID="marriage-hand-footer" style={{ flexShrink: 0,
    borderTopWidth: 1, borderColor: colors.border, padding: 10, paddingBottom: 12, gap: 6 }}>{footer}</View> : null;
  if (!mobile) return <View ref={anchor} style={{ maxHeight: '60%', minHeight: 0 }}>{header}
    <ScrollView style={{ minHeight: 0 }} contentContainerStyle={{ paddingBottom: 16 }}>{children}</ScrollView>{actionFooter}</View>;
  return <View ref={anchor} testID="marriage-mobile-hand" style={{ position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 30,
    height: snap === 'expanded' ? '74%' : snap === 'peek' ? '38%' : 62,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    borderTopLeftRadius: 18, borderTopRightRadius: 18, overflow: 'hidden' }}>
    <View style={{ alignSelf: 'center', marginTop: 5, width: 36, height: 3, borderRadius: 2, backgroundColor: colors.border }} />
    {controls}
    <View style={{ flex: 1, minHeight: 0, display: open ? 'flex' : 'none' }} accessibilityElementsHidden={!open} importantForAccessibility={open ? 'auto' : 'no-hide-descendants'}>
      {header}
      <ScrollView testID="marriage-hand-content" style={{ flex: 1, minHeight: 0 }} nestedScrollEnabled contentContainerStyle={{ paddingBottom: 16 }}>{children}</ScrollView>
      {actionFooter}
    </View>
  </View>;
}
