import { StyleSheet, View } from 'react-native';
import { useTheme } from '../theme';

export function HandAreaOutline() {
  const { colors } = useTheme();
  return <View testID="hand-area-outline" pointerEvents="none" accessible={false} style={[StyleSheet.absoluteFill, {
    borderWidth: 1, borderColor: colors.tableTrim, borderTopLeftRadius: 20, borderTopRightRadius: 20, zIndex: 100,
  }]} />;
}
