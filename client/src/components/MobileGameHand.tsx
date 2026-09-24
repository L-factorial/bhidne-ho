import { ui } from '../i18n/copy.ts';
import { useUiLanguage } from '../i18n/useUiLanguage';
import { HandAreaBar } from './HandAreaBar';
import { useSocialHandAnchor } from './TableSocial';
import { type ReactNode, useEffect, useRef } from 'react';
import { AccessibilityInfo, Animated, Pressable, ScrollView, View } from 'react-native';
import { useTheme } from '../theme';

export function MobileGameHand({ mobile, open, onToggle, docked = false, desktopDrawer = false, myTurn, attention = myTurn, attentionText, children, game = 'flush', keepMounted = false, header, cardCount }: {
  cardCount?: number; header?: ReactNode; docked?: boolean; desktopDrawer?: boolean;
  attention?: boolean; attentionText?: string;
  game?: string; keepMounted?: boolean;
  mobile: boolean; open: boolean; onToggle: () => void; myTurn: boolean; children: ReactNode;
}) {
  useUiLanguage();
  const socialAnchor = useSocialHandAnchor();
  const { colors } = useTheme();
  const content = useRef<ScrollView>(null);
  useEffect(() => { if (desktopDrawer && open) content.current?.scrollTo({ y: 0, animated: false }); }, [desktopDrawer, open]);
  const slide = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    let active = true;
    slide.setValue(open ? 24 : 0);
    AccessibilityInfo.isReduceMotionEnabled().then(reduced => {
      if (active) Animated.timing(slide, { toValue: 0, duration: reduced ? 0 : 180, useNativeDriver: true }).start();
    });
    return () => { active = false; slide.stopAnimation(); };
  }, [open, slide]);
  if (!mobile && !desktopDrawer) return <>{children}</>;
  return <>
    {open && !docked && <Pressable testID={`${game}-hand-backdrop`} accessibilityRole="button" accessibilityLabel={ui("common.close_your_card_area")}
      onPress={onToggle} style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, zIndex: 29, backgroundColor: colors.overlay }} />}
    <Animated.View ref={socialAnchor.ref} onLayout={socialAnchor.onLayout} testID={`${game}-mobile-hand`} style={{ position: docked ? 'relative' : 'absolute', bottom: 0, left: 0, right: 0,
    maxHeight: docked ? '42%' : '88%', flexShrink: 0, zIndex: 30, elevation: 16, transform: [{ translateY: slide }], borderWidth: 1, borderColor: colors.tableTrim,
    borderTopLeftRadius: 20, borderTopRightRadius: 20, overflow: 'hidden', backgroundColor: colors.surface }}>
    <View style={{ alignItems: 'center', paddingTop: 7, backgroundColor: colors.tableHeader }}>
      <View style={{ width: 38, height: 4, borderRadius: 2, backgroundColor: colors.tableTrim }} />
    </View>
    <Animated.View testID={`${game}-hand-attention`} style={{ position: 'relative' }}>
    <HandAreaBar open={open} onToggle={onToggle} count={cardCount} attention={attention}
      instruction={myTurn ? ui("common.your_turn_action", { "action": attentionText || 'Choose an action' }) : attentionText}/>
    </Animated.View>
    {(open || keepMounted) && <ScrollView ref={content} style={!open && { display: 'none' }} accessibilityElementsHidden={!open} importantForAccessibility={open ? 'auto' : 'no-hide-descendants'} testID={`${game}-hand-content`} contentContainerStyle={{ padding: 8, paddingBottom: 18 }} nestedScrollEnabled>
      {header}{children}
    </ScrollView>}
  </Animated.View></>;
}
