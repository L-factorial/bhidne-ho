import {createContext,useContext,forwardRef} from 'react';
import {Text as NativeText,StyleSheet,type TextProps} from 'react-native';
import {fonts,typography as sizes,useTheme} from '../theme';

const NestedText=createContext(false);
/** Shared readable typography, preserving inline text inheritance and OS scaling. */
export const AppText=forwardRef<NativeText,TextProps>(function AppText({style,children,...props},ref){
  const nested=useContext(NestedText);
  const {colors}=useTheme();
  const resolved=StyleSheet.flatten(style)||{};
  const heading=props.accessibilityRole==='header'||resolved.fontFamily===fonts.display||resolved.fontFamily===fonts.editorial;
  const card=resolved.fontFamily===fonts.card;
  const requested=resolved.fontSize??(heading?sizes.pageTitle:sizes.body);
  const size=card ? requested : heading ? (requested>36 ? requested : requested>=26 ? sizes.pageTitle : sizes.sectionTitle)
    : resolved.fontFamily===fonts.medium ? Math.max(15,requested) : requested<=14 ? sizes.metadata : Math.max(sizes.body,requested);
  const typography=nested?{}:{fontFamily:heading?fonts.editorial:resolved.fontFamily??fonts.body,
    fontSize:size,lineHeight:Math.max(resolved.lineHeight??0,Math.ceil(size*(card?1.2:heading?1.3:1.45))),color:resolved.color??colors.text};
  return <NativeText {...props} ref={ref} style={[style,typography]}>
    <NestedText.Provider value={true}>{children}</NestedText.Provider>
  </NativeText>;
});
