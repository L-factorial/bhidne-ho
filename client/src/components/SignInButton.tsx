import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import Svg, { Path } from 'react-native-svg';
import { fonts, useTheme, useThemedStyles, type ThemeColors } from '../theme';

export type SignInMethod = 'Apple' | 'Google' | 'Facebook' | 'guest';
function GoogleIcon() {
  return (
    <Svg width={22} height={22} viewBox="0 0 48 48">
      <Path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5Z" />
      <Path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.17 7.09-10.32 7.09-17.65Z" />
      <Path fill="#FBBC05" d="M10.53 28.59A14.4 14.4 0 0 1 9.75 24c0-1.59.27-3.13.78-4.59l-7.98-6.19A23.87 23.87 0 0 0 0 24c0 3.87.93 7.53 2.56 10.78l7.97-6.19Z" />
      <Path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.9-5.8l-7.73-6c-2.15 1.45-4.92 2.3-8.17 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48Z" />
    </Svg>
  );
}
export function SignInButton({ method, onPress }: { method: SignInMethod; onPress: () => void }) {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const [focused, setFocused] = useState(false);
  const backgroundColor = { Apple: '#141414', Google: '#FFFFFF', Facebook: '#0866FF', guest: colors.primary }[method];
  const color = method === 'Google' ? '#242424' : '#FFFFFF';
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={method === 'guest' ? 'Play as guest' : `Continue with ${method}`}
      onPress={onPress} onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)} style={({ pressed }) => [
        styles.button, { backgroundColor, opacity: pressed ? 0.78 : 1 },
        method === 'Google' && styles.google, focused && styles.focused,
      ]}>
      <View style={styles.icon}>
        {method === 'Google' ? <GoogleIcon /> : (
          <FontAwesome name={method === 'Apple' ? 'apple' : method === 'Facebook' ? 'facebook-square' : 'user'} size={24} color={color} />
        )}
      </View>
      <Text style={[styles.label, { color }]}>{method === 'guest' ? 'Play as guest' : `Continue with ${method}`}</Text>
      <View style={styles.balance} />
    </Pressable>
  );
}
const createStyles = (colors: ThemeColors) => StyleSheet.create({
  button: { minHeight: 56, borderRadius: 11, paddingHorizontal: 20, paddingVertical: 15,
    flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderColor: 'transparent' },
  google: { borderColor: colors.surfaceRaised, boxShadow: '0px 3px 8px rgba(16, 35, 56, 0.05)' },
  focused: { outlineWidth: 3, outlineColor: colors.accent, outlineOffset: 4 },
  icon: { width: 26, alignItems: 'center' }, balance: { width: 26 },
  label: { flex: 1, textAlign: 'center', fontFamily: fonts.medium, fontSize: 15 },
});
