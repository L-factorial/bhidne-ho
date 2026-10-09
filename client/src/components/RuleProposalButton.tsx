import { Pressable } from 'react-native';
import { AppText as Text } from './AppText';
import { fonts, radii, useTheme, visualStates } from '../theme';
import { ui } from '../i18n/copy';

export function RuleProposalButton({ busy, disabled = false, onPress }: { busy: boolean; disabled?: boolean; onPress: () => void }) {
  const { colors } = useTheme();
  return <Pressable accessibilityRole="button" accessibilityLabel={ui('common.propose_changes')} disabled={busy || disabled} accessibilityState={{ disabled: busy || disabled }} onPress={onPress}
    style={{ width: '100%', minHeight: 52, borderRadius: radii.medium, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary, borderWidth: 1, borderColor: colors.onPrimary, opacity: busy || disabled ? visualStates.disabledOpacity : 1 }}>
    <Text style={{ color: colors.onPrimary, fontFamily: fonts.medium }}>{ui(busy ? 'common.proposing' : 'common.propose_changes')}</Text>
  </Pressable>;
}
