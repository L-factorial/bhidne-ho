import { StyleSheet, Text, View } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';

// One decorative back for every hidden card, independent of its face or suit.
export function MarriageCardBack() {
  return <View testID="marriage-card-back" pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.back}>
    <Svg width="100%" height="100%" viewBox="0 0 50 74" preserveAspectRatio="none" style={StyleSheet.absoluteFill}>
      <Rect width="50" height="74" fill="#62ACDE" />
      <Path d="M-20 0L50 70 M-10 0L60 70 M0 0L70 70 M10 0L80 70 M20 0L90 70 M30 0L100 70 M40 0L110 70 M-30 0L40 70 M-40 0L30 70 M-50 0L20 70 M-60 0L10 70 M-70 0L0 70" stroke="#A9DBF2" strokeWidth="1" />
      <Rect x="4" y="4" width="42" height="66" rx="4" fill="none" stroke="#FFF2D7" strokeWidth="1.5" />
      <Path d="M25 20L39 37L25 54L11 37Z" fill="#2E79B5" stroke="#FFF2D7" strokeWidth="1.5" />
    </Svg>
    <Text style={styles.star}>✦</Text>
  </View>;
}

const styles = StyleSheet.create({
  back: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, borderRadius: 5, overflow: 'hidden', backgroundColor: '#62ACDE', alignItems: 'center', justifyContent: 'center' },
  star: { color: '#FFF5DE', fontSize: 23, fontWeight: 'bold' },
});
