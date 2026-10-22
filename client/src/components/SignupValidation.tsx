import {View} from 'react-native';
import {AppText as Text} from './AppText';
import {ui} from '../i18n/copy';
import {useUiLanguage} from '../i18n/useUiLanguage';
import type {UiKey} from '../i18n/catalogs';
import {fonts,useTheme} from '../theme';
import {signupUsernameRules,validSignupPassword} from '../auth/signupValidation';
import {validSignupEmail} from '../auth/email';

/** Field requirements stay visible; state is communicated by text and symbols. */
export function SignupValidation({field,value,password=''}:{field:'username'|'password'|'email'|'confirm';value:string;password?:string}) {
  useUiLanguage();
  const {colors}=useTheme();
  const username=signupUsernameRules(value);
  const rules:{key:UiKey;valid:boolean}[]=field==='username'?[
    {key:'common.signup_username_length',valid:username[0]},
    {key:'common.signup_username_characters',valid:username[1]},
    {key:'common.signup_username_start',valid:username[2]},
  ]:field==='password'?[
    {key:'common.signup_password_length',valid:validSignupPassword(value)},
  ]:field==='email'?[
    {key:'common.signup_email_format',valid:validSignupEmail(value)},
  ]:[{key:'common.signup_password_matches',valid:!!password&&value===password}];
  return <View testID={`signup-validation-${field}`} style={{gap:3,marginTop:-4,marginBottom:4}}>
    {rules.map(rule=>{
      const state=!value?'neutral':rule.valid?'valid':'invalid';
      return <Text key={rule.key} testID={`signup-rule-${rule.key.split('.').pop()}`} accessibilityLiveRegion="polite"
        style={{fontFamily:fonts.body,fontSize:12,lineHeight:18,color:state==='neutral'?colors.textMuted:state==='valid'?colors.success:colors.danger}}>
        {state==='neutral'?'○':state==='valid'?'✓':'×'} {ui(rule.key)}
      </Text>;
    })}
  </View>;
}
