import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { fonts, useTheme } from '../theme';

export function FlushLockButton({ disabled, onPress }: { disabled: boolean; onPress: () => void }) {
  const { colors } = useTheme();
  const glow = useRef(new Animated.Value(0)).current;
  const [reduced, setReduced] = useState(true);
  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then(value => { if (mounted) setReduced(value); }).catch(() => {});
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => { mounted = false; subscription.remove(); };
  }, []);
  useEffect(() => {
    glow.setValue(0);
    if (disabled || reduced) return;
    const animation = Animated.loop(Animated.sequence([
      Animated.timing(glow, { toValue: 1, duration: 1100, useNativeDriver: true }),
      Animated.timing(glow, { toValue: 0, duration: 1100, useNativeDriver: true }),
    ]));
    animation.start();
    return () => animation.stop();
  }, [disabled, reduced, glow]);
  return <View style={{ marginVertical: 6 }}>
    {!disabled && <Animated.View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
      style={[StyleSheet.absoluteFill, { borderRadius: 14, backgroundColor: colors.turnText,
        shadowColor: colors.turnText, shadowOpacity: 0.65, shadowRadius: 12, shadowOffset: { width: 0, height: 0 },
        opacity: glow.interpolate({ inputRange: [0, 1], outputRange: [0.18, 0.42] }),
        transform: [{ scale: glow.interpolate({ inputRange: [0, 1], outputRange: [1.01, 1.045] }) }],
      }]} />}
    <Pressable accessibilityRole="button" accessibilityLabel="Lock table" accessibilityState={{ disabled }} disabled={disabled}
      onPress={onPress} style={({ pressed }) => ({ minHeight: 52, borderRadius: 12, borderWidth: 2,
        borderColor: disabled ? colors.border : colors.turnText, backgroundColor: disabled ? colors.surface : colors.turnSurface,
        alignItems: 'center', justifyContent: 'center', padding: 12, opacity: disabled ? 0.45 : pressed ? 0.85 : 1 })}>
      <Text style={{ color: disabled ? colors.textMuted : colors.turnText, fontFamily: fonts.medium, fontSize: 18, fontWeight: 'bold' }}>Lock table</Text>
    </Pressable>
  </View>;
}
