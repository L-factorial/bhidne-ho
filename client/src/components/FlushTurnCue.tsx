import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, StyleSheet } from 'react-native';
import { observeFlushDecision } from '../multiplayer/flushDecision';
import { useTheme } from '../theme';

/** A transient border; hydration, resync and repeated snapshots remain quiet. */
export function FlushTurnCue({ scope, decision, personal, ready }: {
  scope: string; decision: string | null; personal: boolean; ready: boolean;
}) {
  const { colors } = useTheme();
  const opacity = useRef(new Animated.Value(0)).current;
  const previous = useRef<Parameters<typeof observeFlushDecision>[0]>(null);
  const [reduced, setReduced] = useState(true);
  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then(value => { if (mounted) setReduced(value); }).catch(() => {});
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => { mounted = false; subscription.remove(); };
  }, []);
  useEffect(() => {
    const result = observeFlushDecision(previous.current, { scope, decision, ready }, personal);
    previous.current = result.observation;
    opacity.setValue(0);
    if (!result.cue || reduced) return;
    const animation = Animated.sequence([
      Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 0, duration: 620, useNativeDriver: true }),
    ]);
    animation.start();
    return () => { animation.stop(); opacity.setValue(0); };
  }, [scope, decision, personal, ready, reduced, opacity]);
  return <Animated.View pointerEvents="none" testID="flush-turn-cue" style={[StyleSheet.absoluteFill, {
    opacity, borderWidth: 2, borderColor: colors.turnText, borderRadius: 10,
  }]} />;
}
