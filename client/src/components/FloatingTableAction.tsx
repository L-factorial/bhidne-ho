import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Pressable, Text } from 'react-native';
import { fonts, gameButtonStyle, useTheme } from '../theme';

/** Visual emphasis only. Eligibility and commands remain owned by each game. */
export function FloatingTableAction({ label, disabled = false, onPress, testID }: {
  label: string; disabled?: boolean; onPress: () => void; testID?: string;
}) {
  const { colors } = useTheme();
  const pulse = useRef(new Animated.Value(0)).current;
  const [reduceMotion, setReduceMotion] = useState(true);
  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then(value => { if (mounted) setReduceMotion(value); }).catch(() => {});
    const listener = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => { mounted = false; listener.remove(); };
  }, []);
  useEffect(() => {
    pulse.setValue(0);
    if (disabled || reduceMotion) return;
    const animation = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0, duration: 700, useNativeDriver: true }),
      Animated.delay(650),
    ]));
    animation.start();
    return () => { animation.stop(); pulse.stopAnimation(); pulse.setValue(0); };
  }, [disabled, reduceMotion, pulse]);
  return <Animated.View testID="floating-table-action" style={{ maxWidth: '100%', marginVertical: 5, transform: [{ translateY: pulse.interpolate({ inputRange: [0, 1], outputRange: [0, -3] }) }, { scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.06] }) }] }}>
    {!disabled && <Animated.View pointerEvents="none" style={{ position: 'absolute', top: -5, bottom: -5, left: -5, right: -5, borderRadius: 15, borderWidth: 2, borderColor: colors.attention, opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.2, 0.7] }) }} />}
    <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
      style={({ pressed }) => ({ ...gameButtonStyle(colors, 'primary', pressed), minHeight: 50, minWidth: 120, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center', opacity: disabled ? 0.45 : 1, boxShadow: '0px 5px 12px rgba(0,0,0,0.35), inset 0px 1px 0px rgba(255,248,235,0.25)' })}>
      <Text testID="action-cue" style={{ color: colors.onPrimary, fontFamily: fonts.medium, fontSize: 16, textAlign: 'center' }}>{label}</Text>
    </Pressable>
  </Animated.View>;
}
