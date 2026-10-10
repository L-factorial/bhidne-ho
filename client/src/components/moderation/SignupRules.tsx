import { useContext } from 'react';
import { Pressable, View } from 'react-native';
import { AppText as Text } from '../AppText';
import { PolicyNavigation } from './PublicPolicies';
import { useUiLanguage } from '../../i18n/useUiLanguage';
import { useTheme } from '../../theme';

export {SIGNUP_RULES_VERSION} from '../../auth/communityRules';
export function SignupRules({accepted, onChange, disabled = false}: {
  accepted: boolean; onChange: (value: boolean) => void; disabled?: boolean;
}) {
  const ne = useUiLanguage() === 'ne', {colors} = useTheme();
  const open = useContext(PolicyNavigation);
  const label = ne ? 'म समुदाय नियम स्वीकार गर्छु' : 'I agree to the community rules';
  return <View>
    <Pressable accessibilityRole="checkbox" accessibilityLabel={label}
      accessibilityState={{checked: accepted, disabled}} disabled={disabled}
      onPress={() => onChange(!accepted)} style={{minHeight:44, flexDirection:'row', alignItems:'center', gap:10}}>
      <Text style={{color:colors.accent, fontSize:24}}>{accepted ? '☑' : '☐'}</Text>
      <Text style={{color:colors.text, flexShrink:1}}>{label}</Text>
    </Pressable>
    <Pressable accessibilityRole="link" disabled={disabled} onPress={() => open('community-rules')}
      style={{minHeight:44, justifyContent:'center'}}>
      <Text style={{color:colors.accent}}>{ne ? 'समुदाय नियम पढ्नुहोस्' : 'Read community rules'}</Text>
    </Pressable>
  </View>;
}
