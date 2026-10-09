import {AppText as Text} from './AppText';
import {} from 'react-native';
import { radii, fonts, useTheme } from '../theme';

export function TurnIndicator({ text, personal = false, testID, announcementOnly = false }: { text: string; personal?: boolean; testID?: string; announcementOnly?: boolean }) {
  const { colors } = useTheme();
  if (announcementOnly) return <Text testID={testID} accessibilityLiveRegion="polite" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', opacity: 0 }}>{text}</Text>;
  return <Text testID={testID} accessibilityLiveRegion="polite" style={{ textAlign: 'center', paddingVertical: 6, paddingHorizontal: 10, borderRadius: radii.medium, borderWidth: 0, borderColor: colors.attention, backgroundColor: 'transparent',
    color: colors.textMuted, fontFamily: fonts.medium, fontSize: 13 }}>{text}</Text>;
}
