import { Text, type TextProps } from 'react-native';

export function ActionCue({ active: _active, ...props }: TextProps & { active: boolean }) {
  return <Text {...props} testID="action-cue" accessibilityLiveRegion="none" />;
}
