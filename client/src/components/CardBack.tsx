import { StyleSheet, View } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';
import { useTheme } from '../theme';

// Original stepped diamonds inspired by geometric weaving, not a copied textile.
// Fill the host by default; explicit sizes are useful for standalone deck previews.
export function CardBack({ testID = 'card-back', size }: { testID?: string; size?: 'small' | 'medium' | 'large' }) {
  const { colors } = useTheme();
  const dimensions = size ? { width: { small: 44, medium: 58, large: 80 }[size], aspectRatio: 50 / 74 } : StyleSheet.absoluteFill;
  return <View testID={testID} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
    style={[dimensions, { borderRadius: 5, overflow: 'hidden', backgroundColor: colors.cardBack }]}>
    <Svg width="100%" height="100%" viewBox="0 0 50 74" preserveAspectRatio="none">
      <Rect width="50" height="74" rx="4" fill={colors.cardBack} />
      {[12, 25, 38].flatMap(x => [13, 29, 45, 61].map(y => <Path key={`${x}:${y}`}
        d={`M${x} ${y-6}h2v2h2v2h2v4h-2v2h-2v2h-4v-2h-2v-2h-2v-4h2v-2h2v-2Z`}
        fill="none" stroke={colors.cardPattern} strokeWidth=".8" />))}
      <Rect x="1" y="1" width="48" height="72" rx="4" fill="none" stroke={colors.cardBackBorder} strokeWidth="1.2" />
      <Rect x="4" y="4" width="42" height="66" rx="3" fill="none" stroke={colors.cardInnerBorder} strokeWidth=".65" />
      <Path d="M25 26L34 37L25 48L16 37Z" fill={colors.cardBack} stroke={colors.cardMark} strokeWidth=".9" />
      <Path d="M25 32L27 35L30 37L27 39L25 42L23 39L20 37L23 35Z" fill={colors.cardMark} />
    </Svg>
  </View>;
}
