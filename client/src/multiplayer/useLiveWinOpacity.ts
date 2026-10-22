import {useEffect, useRef, useState} from 'react';
import {AccessibilityInfo, Animated} from 'react-native';

/** The same readable live-count pulse on the table and in the hand drawer. */
export function useLiveWinOpacity(active: boolean) {
  const opacity = useRef(new Animated.Value(1)).current;
  const [reduced, setReduced] = useState(true);
  useEffect(() => {
    if (!active) { setReduced(true); return; }
    let alive = true;
    void AccessibilityInfo.isReduceMotionEnabled().then(value => { if (alive) setReduced(value); }).catch(() => {});
    const listener = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => { alive = false; listener.remove(); };
  }, [active]);
  useEffect(() => {
    opacity.setValue(1);
    if (!active || reduced) return;
    const pulse = Animated.loop(Animated.sequence([
      Animated.timing(opacity, {toValue: .55, duration: 900, useNativeDriver: true}),
      Animated.timing(opacity, {toValue: 1, duration: 900, useNativeDriver: true}),
    ]));
    pulse.start();
    return () => { pulse.stop(); opacity.setValue(1); };
  }, [active, reduced, opacity]);
  return opacity;
}
