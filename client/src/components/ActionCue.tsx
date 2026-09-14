import type { TextProps } from 'react-native';
import { TurnPulse } from './TurnPulse';

// Slow pulse, stopped for disabled actions and the device's Reduce Motion setting.
export function ActionCue({ active, ...props }: TextProps & { active: boolean }) {
  return <TurnPulse {...props} active={active} testID="action-cue" accessibilityLiveRegion="none" />;
}
