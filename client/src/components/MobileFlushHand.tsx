import { type ReactNode, useEffect, useRef } from 'react';
import { AccessibilityInfo, Animated, Pressable, ScrollView, Text } from 'react-native';
import { fonts, useTheme } from '../theme';

export function MobileFlushHand({ mobile, open, onToggle, myTurn, children }: {
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
  return <Animated.View testID="flush-mobile-hand" style={{ position: 'absolute', bottom: 0, left: 0, right: 0,
    maxHeight: '85%', zIndex: 10, transform: [{ translateY: slide }], borderWidth: 1, borderColor: colors.border,
    borderRadius: 16, overflow: 'hidden', backgroundColor: open ? `${colors.background}55` : colors.surface }}>
    <Pressable accessibilityRole="button" accessibilityLabel={open ? 'Collapse your cards' : 'Expand your cards'}
      accessibilityState={{ expanded: open }} onPress={onToggle}
      style={{ minHeight: 48, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.surface }}>
      <Text style={{ fontFamily: fonts.medium, color: myTurn ? colors.turnText : colors.text }}>Your cards{myTurn ? ' · Your turn' : ''}</Text>
      <Text style={{ color: colors.text, fontSize: 22 }}>{open ? '⌄' : '⌃'}</Text>
    </Pressable>
    {open && <ScrollView testID="flush-hand-content" contentContainerStyle={{ padding: 8 }} nestedScrollEnabled>{children}</ScrollView>}
  </Animated.View>;
}
