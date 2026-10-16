import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, StyleSheet, View } from 'react-native';
import { useTheme } from '../theme';

export function HandAreaOutline({ active = false, prominent = false }: { active?: boolean; prominent?:boolean }) {
  const { colors } = useTheme();
  const opacity = useRef(new Animated.Value(1)).current;
  const [reduced, setReduced] = useState(true);
  useEffect(() => { let alive = true; void AccessibilityInfo.isReduceMotionEnabled().then(value => { if (alive) setReduced(value); }); const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced); return () => { alive = false; sub.remove(); }; }, []);
  useEffect(() => { opacity.setValue(1); if (!active || reduced) return; const animation = Animated.loop(Animated.sequence([Animated.timing(opacity, {toValue:prominent ? .55 : .35,duration:650,useNativeDriver:true}),Animated.timing(opacity,{toValue:1,duration:650,useNativeDriver:true})])); animation.start(); return () => animation.stop(); }, [active,reduced,opacity,prominent]);
  return <Animated.View testID="hand-area-outline" pointerEvents="none" accessible={false} style={[StyleSheet.absoluteFill, {
    opacity, borderWidth: active ? 3 : 1, borderColor: colors.tableTrim, borderTopLeftRadius: 20, borderTopRightRadius: 20, zIndex: 100,
  }, prominent && active && {
    top:6,right:6,bottom:6,left:6,borderWidth:4,borderRadius:16,
    boxShadow:`0 0 8px 2px ${colors.tableTrim}, inset 0 0 10px 2px ${colors.tableTrim}`,
  }]} />;
}
