import { View } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { useTheme, type ThemeColors } from '../theme';

// Decorative vector artwork keeps scenery crisp at every size and uses the selected palette.
export function NepaliLandscape({ colors, height = 76 }: { colors?: ThemeColors; height?: number }) {
  const theme = useTheme();
  const c = colors || theme.colors;
  return <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
    style={{ height, overflow: 'hidden', borderRadius: 10, backgroundColor: c.surfaceRaised }}>
    <Svg width="100%" height="100%" viewBox="0 0 600 120" preserveAspectRatio="xMidYMax meet">
      <Rect width="600" height="120" fill={c.surfaceRaised} />
      <Circle cx="450" cy="30" r="20" fill={c.coin} opacity={0.65} />
      <Path d="M0 100L85 24L132 65L220 6L330 103L395 54L485 110L540 61L600 101V120H0Z" fill={c.textMuted} opacity={0.3} />
      <Path d="M170 53L220 6L269 50L237 36L220 43L203 32Z M57 49L85 24L114 50L86 40Z" fill={c.cardFace} opacity={0.85} />
      <Path d="M0 108Q90 67 178 99T360 96T600 87V120H0Z" fill={c.accent} opacity={0.2} />
      <Rect x="459" y="73" width="38" height="42" fill={c.accent} opacity={0.75} />
      <Path d="M443 78Q466 69 478 59Q490 69 513 78Z M451 59Q468 53 478 43Q488 53 505 59Z M461 41L478 27L495 41Z" fill={c.accent} />
      <Path d="M478 22V31 M450 114H509" stroke={c.accent} strokeWidth="3" />
      <Rect x="474" y="87" width="9" height="28" fill={c.surfaceRaised} />
    </Svg>
  </View>;
}
