import {createContext,useContext,forwardRef} from 'react';
import {Text as NativeText,StyleSheet,type TextProps} from 'react-native';
import {fonts,useTheme} from '../theme';

const NestedText=createContext(false);
/** Shared readable typography, preserving inline text inheritance and OS scaling. */
export const AppText=forwardRef<NativeText,TextProps>(function AppText({style,children,...props},ref){
  const nested=useContext(NestedText);
  const {colors}=useTheme();
  const resolved=StyleSheet.flatten(style)||{};
  const heading=props.accessibilityRole==='header'||resolved.fontFamily===fonts.display||resolved.fontFamily===fonts.editorial;
  const requested=resolved.fontSize??(heading?26:16);
  const size=Math.max(requested,heading?22:requested<=13?14:resolved.fontFamily===fonts.medium?15:16);
  const typography=nested?{}:{fontFamily:heading?fonts.editorial:resolved.fontFamily??fonts.body,
    fontSize:size,lineHeight:Math.max(resolved.lineHeight??0,Math.ceil(size*(heading?1.2:1.4))),color:resolved.color??colors.text};
  return <NativeText {...props} ref={ref} style={[style,typography]}>
    <NestedText.Provider value={true}>{children}</NestedText.Provider>
  </NativeText>;
});
