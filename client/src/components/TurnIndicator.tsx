import { Text } from 'react-native';
import { fonts, useTheme } from '../theme';

export function TurnIndicator({ text, personal = false, testID }: { text: string; personal?: boolean; testID?: string }) {
  const { colors } = useTheme();
  return <Text testID={testID} accessibilityLiveRegion="polite" style={{ textAlign: 'center', paddingVertical: 4,
    color: personal ? colors.turnText : colors.textMuted, fontFamily: fonts.medium, fontSize: 13 }}>{text}</Text>;
}
