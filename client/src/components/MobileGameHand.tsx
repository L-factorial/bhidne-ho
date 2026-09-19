import { useSocialHandAnchor } from './TableSocial';
import { type ReactNode, useEffect, useRef } from 'react';
import { AccessibilityInfo, Animated, Pressable, ScrollView, Text, View } from 'react-native';
import { fonts, useTheme } from '../theme';

export function MobileGameHand({ mobile, open, onToggle, docked = false, desktopDrawer = false, myTurn, attention = myTurn, attentionText, children, game = 'flush', keepMounted = false, header }: {
  header?: ReactNode; docked?: boolean; desktopDrawer?: boolean;
  attention?: boolean; attentionText?: string;
  game?: string; keepMounted?: boolean;
  mobile: boolean; open: boolean; onToggle: () => void; myTurn: boolean; children: ReactNode;
}) {
  const socialAnchor = useSocialHandAnchor();
  const { colors } = useTheme();
  const content = useRef<ScrollView>(null);
  useEffect(() => { if (desktopDrawer && open) content.current?.scrollTo({ y: 0, animated: false }); }, [desktopDrawer, open]);
  const slide = useRef(new Animated.Value(0)).current;
  const attentionOpacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    let active = true;
    slide.setValue(open ? 24 : 0);
    AccessibilityInfo.isReduceMotionEnabled().then(reduced => {
      if (active) Animated.timing(slide, { toValue: 0, duration: reduced ? 0 : 180, useNativeDriver: true }).start();
    });
    return () => { active = false; slide.stopAnimation(); };
  }, [open, slide]);
  useEffect(() => {
    let active = true;
    let loop: Animated.CompositeAnimation | undefined;
    attentionOpacity.setValue(1);
    if (attention && !open && !docked) AccessibilityInfo.isReduceMotionEnabled().then(reduced => {
      if (!active || reduced) return;
      loop = Animated.loop(Animated.sequence([
        Animated.timing(attentionOpacity, { toValue: 0.58, duration: 650, useNativeDriver: true }),
        Animated.timing(attentionOpacity, { toValue: 1, duration: 650, useNativeDriver: true }),
      ]));
      loop.start();
    });
    return () => { active = false; loop?.stop(); attentionOpacity.stopAnimation(); attentionOpacity.setValue(1); };
  }, [attention, open, attentionOpacity, docked]);
  if (!mobile && !desktopDrawer) return <>{children}</>;
  return <>
    {open && !docked && <Pressable testID={`${game}-hand-backdrop`} accessibilityRole="button" accessibilityLabel="Close your card area"
      onPress={onToggle} style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, zIndex: 29, backgroundColor: colors.overlay }} />}
    <Animated.View ref={socialAnchor.ref} onLayout={socialAnchor.onLayout} testID={`${game}-mobile-hand`} style={{ position: docked ? 'relative' : 'absolute', bottom: 0, left: 0, right: 0,
    maxHeight: docked ? '44%' : '88%', flexShrink: 0, zIndex: 30, elevation: 16, transform: [{ translateY: slide }], borderWidth: 1, borderColor: colors.border,
    borderTopLeftRadius: 20, borderTopRightRadius: 20, overflow: 'hidden', backgroundColor: colors.surface }}>
    <View style={{ alignItems: 'center', paddingTop: 7, backgroundColor: colors.surface }}>
      <View style={{ width: 38, height: 4, borderRadius: 2, backgroundColor: colors.border }} />
    </View>
    <Animated.View testID={`${game}-hand-attention`} style={{ opacity: attentionOpacity, borderTopWidth: attention && !open ? 2 : 0, borderColor: colors.attention }}>
    <Pressable accessibilityRole="button" accessibilityLabel={open ? 'Collapse your card area' : 'Expand your card area'}
      accessibilityState={{ expanded: open }} onPress={onToggle}
      style={{ minHeight: 50, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: attention ? colors.turnSurface : colors.surface }}>
      <Text accessibilityLiveRegion={attention && !open ? 'polite' : 'none'} style={{ fontFamily: fonts.medium, color: attention ? colors.turnText : colors.text }}>{attentionText || `Your card area${myTurn ? ' · Action needed' : ''}`}</Text>
      <Text style={{ color: colors.text, fontSize: 22 }}>{open ? '⌄' : '⌃'}</Text>
    </Pressable>
    </Animated.View>
    {(open || keepMounted) && <ScrollView ref={content} style={!open && { display: 'none' }} accessibilityElementsHidden={!open} importantForAccessibility={open ? 'auto' : 'no-hide-descendants'} testID={`${game}-hand-content`} contentContainerStyle={{ padding: 8, paddingBottom: 18 }} nestedScrollEnabled>
      {header}{children}
    </ScrollView>}
  </Animated.View></>;
}
