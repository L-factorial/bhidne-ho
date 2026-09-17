import { type ReactNode, useEffect, useRef } from 'react';
import { AccessibilityInfo, Animated, Pressable, ScrollView, Text, View } from 'react-native';
import { fonts, useTheme } from '../theme';

export function MobileGameHand({ mobile, open, onToggle, myTurn, children, game = 'flush', keepMounted = false, header }: {
  header?: ReactNode;
  game?: string; keepMounted?: boolean;
  mobile: boolean; open: boolean; onToggle: () => void; myTurn: boolean; children: ReactNode;
}) {
  const { colors } = useTheme();
  const slide = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    let active = true;
    slide.setValue(open ? 24 : 0);
    AccessibilityInfo.isReduceMotionEnabled().then(reduced => {
      if (active) Animated.timing(slide, { toValue: 0, duration: reduced ? 0 : 180, useNativeDriver: true }).start();
    });
    return () => { active = false; slide.stopAnimation(); };
  }, [open, slide]);
  if (!mobile) return <>{children}</>;
  return <>
    {open && <Pressable testID={`${game}-hand-backdrop`} accessibilityRole="button" accessibilityLabel="Close your card area"
      onPress={onToggle} style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, zIndex: 29, backgroundColor: colors.overlay }} />}
    <Animated.View testID={`${game}-mobile-hand`} style={{ position: 'absolute', bottom: 0, left: 0, right: 0,
    maxHeight: '88%', zIndex: 30, elevation: 16, transform: [{ translateY: slide }], borderWidth: 1, borderColor: colors.border,
    borderTopLeftRadius: 20, borderTopRightRadius: 20, overflow: 'hidden', backgroundColor: colors.surface }}>
    <View style={{ alignItems: 'center', paddingTop: 7, backgroundColor: colors.surface }}>
      <View style={{ width: 38, height: 4, borderRadius: 2, backgroundColor: colors.border }} />
    </View>
    <Pressable accessibilityRole="button" accessibilityLabel={open ? 'Collapse your card area' : 'Expand your card area'}
      accessibilityState={{ expanded: open }} onPress={onToggle}
      style={{ minHeight: 50, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.surface }}>
      <Text style={{ fontFamily: fonts.medium, color: myTurn ? colors.turnText : colors.text }}>Your card area{myTurn ? ' · Your turn' : ''}</Text>
      <Text style={{ color: colors.text, fontSize: 22 }}>{open ? '⌄' : '⌃'}</Text>
    </Pressable>
    {(open || keepMounted) && <ScrollView style={!open && { display: 'none' }} accessibilityElementsHidden={!open} importantForAccessibility={open ? 'auto' : 'no-hide-descendants'} testID={`${game}-hand-content`} contentContainerStyle={{ padding: 8, paddingBottom: 18 }} nestedScrollEnabled>
      {header}{children}
    </ScrollView>}
  </Animated.View></>;
}
