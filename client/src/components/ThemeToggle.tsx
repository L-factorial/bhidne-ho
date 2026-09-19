import { Pressable, Text, View } from 'react-native';
import { fonts, useTheme } from '../theme';

export function ThemeToggle({ showSystem = false }: { showSystem?: boolean }) {
  const { colors, mode, toggle, preference, setPreference } = useTheme();
  return <View style={{ flexDirection: 'row', gap: 6 }}><Pressable accessibilityRole="button" accessibilityLabel={`Switch to ${mode === 'dark' ? 'light' : 'dark'} mode`}
    onPress={toggle} style={{ minWidth: 44, minHeight: 44, paddingHorizontal: 10, borderRadius: 8,
      borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' }}>
    <Text style={{ color: colors.text, fontFamily: fonts.medium, fontSize: 18 }}>{mode === 'dark' ? '☀' : '☾'}</Text>
  </Pressable>{showSystem && <Pressable accessibilityRole="button" accessibilityLabel="Use system theme"
    accessibilityState={{ selected: preference === 'system' }} onPress={() => setPreference('system')}
    style={{ minHeight: 44, paddingHorizontal: 8, justifyContent: 'center', borderRadius: 8, borderWidth: 1, borderColor: preference === 'system' ? colors.attention : colors.border }}>
    <Text style={{ color: colors.text, fontFamily: fonts.body, fontSize: 12 }}>System</Text>
  </Pressable>}</View>;
}
