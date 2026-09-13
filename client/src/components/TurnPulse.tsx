import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, StyleSheet, type TextProps } from 'react-native';
import { fonts, useThemedStyles, type ThemeColors } from '../theme';

export function TurnPulse({ text, personal = false, active = true, children, style, ...props }: TextProps & { text?: string; personal?: boolean; active?: boolean }) {
  const styles = useThemedStyles(createStyles);
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
    if (reduceMotion || !active) return;
    const animation = Animated.loop(Animated.sequence([
      Animated.timing(opacity, { toValue: 0.75, duration: 800, useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 1, duration: 800, useNativeDriver: true }),
    ]));
    animation.start();
    return () => { animation.stop(); opacity.setValue(1); };
  }, [opacity, reduceMotion, text, active]);
  return <Animated.Text testID={personal ? 'your-turn-pulse' : 'table-turn-pulse'}
    accessibilityLiveRegion="polite" {...props} style={[style ?? styles.text, personal && styles.personal, { opacity }]}>{text ?? children}</Animated.Text>;
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  text: { color: colors.turnText, fontFamily: fonts.medium, fontWeight: 'bold', fontSize: 18, textAlign: 'center', paddingVertical: 8 },
  personal: { fontSize: 22, backgroundColor: colors.turnSurface, borderColor: colors.turnText, borderWidth: 1, borderRadius: 8, paddingHorizontal: 16 },
});
