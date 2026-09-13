import { StyleSheet, Text, View } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';
import { useTheme } from '../theme';

export function CardBack({ testID = 'card-back' }: { testID?: string }) {
  const { colors } = useTheme();
  return <View testID={testID} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
    style={[StyleSheet.absoluteFill, { borderRadius: 5, overflow: 'hidden', backgroundColor: colors.cardBack, alignItems: 'center', justifyContent: 'center' }]}>
    <Svg width="100%" height="100%" viewBox="0 0 50 74" preserveAspectRatio="none" style={StyleSheet.absoluteFill}>
      <Rect width="50" height="74" fill={colors.cardBack} />
      <Path d="M-20 0L50 70 M-10 0L60 70 M0 0L70 70 M10 0L80 70 M20 0L90 70 M30 0L100 70 M40 0L110 70 M-30 0L40 70 M-40 0L30 70 M-50 0L20 70 M-60 0L10 70 M-70 0L0 70" stroke={colors.cardPattern} strokeWidth="0.7" />
      <Rect x="4" y="4" width="42" height="66" rx="4" fill="none" stroke={colors.cardMark} strokeWidth="1" />
      <Path d="M25 20L39 37L25 54L11 37Z" fill={colors.cardBack} stroke={colors.cardMark} strokeWidth="1" />
    </Svg>
    <Text style={{ color: colors.cardMark, fontSize: 23, fontWeight: 'bold' }}>✦</Text>
  </View>;
}
