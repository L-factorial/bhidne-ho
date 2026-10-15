import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, StyleSheet, View } from 'react-native';
import { useTheme } from '../theme';

export function HandAreaOutline({ active = false }: { active?: boolean }) {
  const { colors } = useTheme();
  const opacity = useRef(new Animated.Value(1)).current;
  const [reduced, setReduced] = useState(true);
  useEffect(() => { let alive = true; void AccessibilityInfo.isReduceMotionEnabled().then(value => { if (alive) setReduced(value); }); const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced); return () => { alive = false; sub.remove(); }; }, []);
  useEffect(() => { opacity.setValue(1); if (!active || reduced) return; const animation = Animated.loop(Animated.sequence([Animated.timing(opacity, {toValue:.35,duration:650,useNativeDriver:true}),Animated.timing(opacity,{toValue:1,duration:650,useNativeDriver:true})])); animation.start(); return () => animation.stop(); }, [active,reduced,opacity]);
  return <Animated.View testID="hand-area-outline" pointerEvents="none" accessible={false} style={[StyleSheet.absoluteFill, {
    opacity, borderWidth: active ? 3 : 1, borderColor: colors.tableTrim, borderTopLeftRadius: 20, borderTopRightRadius: 20, zIndex: 100,
  }]} />;
}
