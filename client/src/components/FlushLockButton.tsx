import { Pressable, Text } from 'react-native';
import { fonts, primaryAction, useTheme } from '../theme';

export function FlushLockButton({ disabled, onPress }: { disabled: boolean; onPress: () => void }) {
  const { colors } = useTheme();
  return <Pressable accessibilityRole="button" accessibilityLabel="Lock table" accessibilityState={{ disabled }} disabled={disabled}
    onPress={onPress} style={({ pressed }) => ({ ...primaryAction(colors, pressed), minHeight: 52, borderRadius: 12,
      padding: 12, alignItems: 'center', justifyContent: 'center', opacity: disabled ? .45 : 1 })}>
    <Text style={{ color: colors.onPrimary, fontFamily: fonts.medium, fontSize: 18 }}>Lock table</Text>
  </Pressable>;
}
