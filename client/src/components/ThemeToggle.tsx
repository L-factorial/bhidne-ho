import { Pressable, Text } from 'react-native';
import { fonts, useTheme } from '../theme';

export function ThemeToggle() {
  const { colors, mode, toggle } = useTheme();
  return <Pressable accessibilityRole="button" accessibilityLabel={`Switch to ${mode === 'dark' ? 'light' : 'dark'} mode`}
    onPress={toggle} style={{ minWidth: 44, minHeight: 44, paddingHorizontal: 10, borderRadius: 8,
      borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' }}>
    <Text style={{ color: colors.text, fontFamily: fonts.medium, fontSize: 18 }}>{mode === 'dark' ? '☀' : '☾'}</Text>
  </Pressable>;
}
