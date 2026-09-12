import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, StyleSheet } from 'react-native';
import { fonts } from '../theme';

export function TurnPulse({ text, personal = false }: { text: string; personal?: boolean }) {
  const opacity = useRef(new Animated.Value(1)).current;
  const [reduceMotion, setReduceMotion] = useState(true);
  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then(value => { if (mounted) setReduceMotion(value); }).catch(() => {});
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => { mounted = false; subscription.remove(); };
  }, []);
  useEffect(() => {
    opacity.setValue(1);
    if (reduceMotion) return;
    const animation = Animated.loop(Animated.sequence([
      Animated.timing(opacity, { toValue: 0.4, duration: 800, useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 1, duration: 800, useNativeDriver: true }),
    ]));
    animation.start();
    return () => { animation.stop(); opacity.setValue(1); };
  }, [opacity, reduceMotion, text]);
  return <Animated.Text testID={personal ? 'your-turn-pulse' : 'table-turn-pulse'}
    accessibilityLiveRegion="polite" style={[styles.text, personal && styles.personal, { opacity }]}>{text}</Animated.Text>;
}

const styles = StyleSheet.create({
  text: { color: '#74F4A3', fontFamily: fonts.medium, fontWeight: 'bold', fontSize: 18, textAlign: 'center', paddingVertical: 8 },
  personal: { fontSize: 22, backgroundColor: '#123D2A', paddingHorizontal: 16 },
});
