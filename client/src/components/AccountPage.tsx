import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppHeader } from './AppHeader';
import { FormScrollView } from './FormInput';
import { FormFooter } from './FormFooter';
import { KeyboardFrame } from './KeyboardFrame';
import { fonts, gameControlFinish, gamePanelFinish, useTheme, type ThemeColors } from '../theme';

/** Shared with the original sign-in form, including its panel and field styling. */
export const accountStyles = (colors: ThemeColors) => StyleSheet.create({
  panel: { ...gamePanelFinish(colors), backgroundColor: colors.surface, borderRadius: 16, padding: 24, gap: 8 },
  input: { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, borderRadius: 8, minHeight: 48, padding: 14, fontFamily: fonts.body, color: colors.text, marginVertical: 10 },
  button: { ...gameControlFinish(colors), backgroundColor: colors.tableHeader, borderWidth: 1, borderColor: colors.tableTrim, minHeight: 48, borderRadius: 8, alignItems: 'center', justifyContent: 'center', padding: 12 },
  buttonText: { fontFamily: fonts.medium, color: colors.text, fontSize: 12 },
  title: { fontFamily: fonts.medium, fontSize: 16, color: colors.text },
  description: { fontFamily: fonts.body, fontSize: 13, lineHeight: 23, color: colors.textMuted },
});

export function AccountPage({ children, footer }: { children: ReactNode; footer: ReactNode }) {
  const { colors } = useTheme(); const insets = useSafeAreaInsets(); const styles = accountStyles(colors);
  return <KeyboardFrame>
    <FormScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{alignItems:'center',paddingHorizontal:16,paddingTop:Math.max(insets.top,16),paddingBottom:24}}>
      <View style={{width:'100%',maxWidth:1120}}>
        <AppHeader hideProfile />
        <View style={styles.panel}>{children}</View>
      </View>
    </FormScrollView>
    <FormFooter>{footer}</FormFooter>
  </KeyboardFrame>;
}
