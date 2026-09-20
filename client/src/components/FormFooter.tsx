import { type ReactNode } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme';

/** Sibling of the scrolling body, so the primary action cannot scroll out of sight. */
export function FormFooter({ children }: { children: ReactNode }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  return <View style={{ flexShrink: 0, paddingHorizontal: 20, paddingTop: 10, paddingBottom: Math.max(12, insets.bottom), backgroundColor: colors.surface }}><View style={{ width: '100%', maxWidth: 680, alignSelf: 'center', gap: 8 }}>{children}</View></View>;
}
