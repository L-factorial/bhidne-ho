import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated } from 'react-native';
import { useTheme } from '../theme';

/** Non-interactive turn emphasis; never dims text or moves a hit target. */
export function TurnGlow({ active, radius = 18 }: { active: boolean; radius?: number }) {
  const { colors } = useTheme();
  const value = useRef(new Animated.Value(0.7)).current;
  const [reduced, setReduced] = useState(true);
  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then(v => { if (mounted) setReduced(v); }).catch(() => {});
    const listener = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => { mounted = false; listener.remove(); };
  }, []);
  useEffect(() => {
    value.setValue(0.7);
    if (!active || reduced) return;
    const animation = Animated.loop(Animated.sequence([
      Animated.timing(value, { toValue: 0.25, duration: 800, useNativeDriver: true }),
      Animated.timing(value, { toValue: 1, duration: 800, useNativeDriver: true }),
    ]));
    animation.start();
    return () => { animation.stop(); value.stopAnimation(); };
  }, [active, reduced, value]);
  return active ? <Animated.View testID="turn-glow" pointerEvents="none" accessible={false} style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, zIndex: 40, borderRadius: radius, borderWidth: 2, borderColor: colors.attention, boxShadow: `inset 0px 0px 10px ${colors.tableTrim}`, opacity: value }} /> : null;
}
