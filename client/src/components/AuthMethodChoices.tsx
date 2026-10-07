import {AppText as Text} from './AppText';
import {Keyboard, Pressable, View} from 'react-native';
import { ui } from '../i18n/copy';
import { useUiLanguage } from '../i18n/useUiLanguage';
import { visualStates, fonts, useTheme } from '../theme';
import { SignInButton } from './SignInButton';

/** Presentation only: providers remain unavailable regardless of backend configuration. */
export function DisabledSocialOptions() {
  useUiLanguage();
  const { colors } = useTheme();
  return <View style={{gap: 8}}>
    {(['Google', 'Facebook', 'Apple'] as const).map(method =>
      <SignInButton key={method} method={method} compact disabled onPress={() => {}} />)}
    <Text style={{color: colors.textMuted, fontFamily: fonts.body, fontSize: 11, textAlign: 'center'}}>{ui('common.social_options_unavailable')}</Text>
  </View>;
}
export function AuthMethodChoices({signup = false, disabled = false, onContinue}: {signup?: boolean; disabled?: boolean; onContinue: () => void}) {
  useUiLanguage();
  const { colors } = useTheme();
  return <View style={{gap: 12}}>
    <DisabledSocialOptions />
    <View style={{flexDirection: 'row', alignItems: 'center', gap: 12, marginVertical: 2}}>
      <View style={{flex: 1, height: 1, backgroundColor: colors.border}} />
      <Text style={{color: colors.textMuted, fontFamily: fonts.body, fontSize: 12}}>{ui('common.auth_or')}</Text>
      <View style={{flex: 1, height: 1, backgroundColor: colors.border}} />
    </View>
    <SignInButton compact method="account" disabled={disabled} label={ui(signup ? 'common.signup_username_email' : 'common.continue_username_email')} onPress={onContinue} />
  </View>;
}

/** Return through auth presentation steps without submitting or clearing the form. */
export function AuthBackButton({onPress, disabled = false}: {onPress: () => void; disabled?: boolean}) {
  useUiLanguage();
  const { colors } = useTheme();
  return <Pressable accessibilityRole="button" accessibilityLabel={ui('common.back')}
    disabled={disabled} accessibilityState={{disabled}}
    onPress={() => { Keyboard.dismiss(); onPress(); }}
    style={{alignSelf: 'flex-start', minHeight: 44, paddingHorizontal: 4, justifyContent: 'center', opacity: disabled ? visualStates.disabledOpacity : 1}}>
    <Text style={{fontFamily: fonts.medium, fontSize: 14, color: colors.accent}}>← {ui('common.back')}</Text>
  </Pressable>;
}
