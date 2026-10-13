import { Image, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useTableTheme } from '../TableThemeProvider';
import { themeScenery } from '../themeScenery';

/** Decoration stays behind content, with a stronger fade through its busy center. */
export function ThemeBackdrop() {
  const { id, theme } = useTableTheme();
  const source = themeScenery(id);
  const base = theme.colors.background;
  return <View testID={`theme-backdrop-${id}`} pointerEvents="none" accessible={false} aria-hidden
    importantForAccessibility="no-hide-descendants" style={[StyleSheet.absoluteFill, { backgroundColor: base, overflow: 'hidden' }]}>
    {!!source && <><Image testID="theme-scenery-image" source={source} resizeMode="cover" accessible={false}
      style={[StyleSheet.absoluteFill, { opacity: 0.52 }]} />
    <LinearGradient colors={[`${base}55`, `${base}D9`, `${base}D9`, `${base}55`]}
      locations={[0, 0.3, 0.7, 1]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} />
    <LinearGradient colors={[`${base}33`, `${base}22`, `${base}BB`]} locations={[0, 0.65, 1]} style={StyleSheet.absoluteFill} /></>}
  </View>;
}
