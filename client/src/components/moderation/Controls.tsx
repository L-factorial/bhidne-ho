import {AppText as Text} from '../AppText';
import {Pressable} from 'react-native';
import { visualStates, radii, fonts, useTheme } from '../../theme';
import { ui } from '../../i18n/copy';
import type { UiKey } from '../../i18n/catalogs';
export function copy(key:string){return ui(`moderation.${key}` as UiKey);}
export function Button({label,onPress,disabled=false,selected=false}: {label:string;onPress:()=>void;disabled?:boolean;selected?:boolean}) {
  const {colors:c}=useTheme();
  return <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} accessibilityState={{disabled,selected}}
    onPress={onPress} style={{minHeight:44,paddingHorizontal:12,paddingVertical:10,borderWidth:1,borderColor:c.border,borderRadius: radii.medium,
      justifyContent:'center',backgroundColor:selected?c.surfaceSelected:c.surface,opacity:disabled ? visualStates.disabledOpacity : 1}}>
    <Text style={{color:c.text,fontFamily:fonts.medium,fontSize:13}}>{label}</Text>
  </Pressable>;
}
export function Copy({children,alert=false}: {children:React.ReactNode;alert?:boolean}) {
  const {colors:c}=useTheme();
  return <Text accessibilityRole={alert?'alert':undefined} style={{color:alert?c.danger:c.text,fontFamily:fonts.body,fontSize:13,lineHeight:21}}>{children}</Text>;
}
