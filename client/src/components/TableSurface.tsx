import { useId } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { ClipPath, Defs, Image, LinearGradient, Pattern, Path, RadialGradient, Rect, Stop } from 'react-native-svg';
import { useTableTheme } from '../TableThemeProvider';
import { tableThemes, type TableThemeId } from '../tableThemes';
import { themeScenery } from '../themeScenery';

/** Decorative only: seat geometry, hit targets and game state remain owned by the table. */
export function TableSurface({ game = 'callbreak', themeId }: { game?: 'callbreak' | 'marriage' | 'flush'; themeId?: TableThemeId }) {
  const id = useId().replace(/:/g, '');
  const preference = useTableTheme();
  const selected = themeId || preference.id;
  const { felt, trim, colors } = tableThemes[selected];
  const monochrome = selected === 'noir' || selected === 'pearl';
  const scenery = themeScenery(selected);
  return <View pointerEvents="none" accessible={false} style={StyleSheet.absoluteFill} testID={`table-surface-${game}`}>
    <Svg width="100%" height="100%" viewBox="0 0 360 460" preserveAspectRatio="none">
      <Defs>
        <LinearGradient id={`${id}wood`} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#B66F3D" /><Stop offset="0.28" stopColor="#562B18" />
          <Stop offset="0.55" stopColor="#8E4727" /><Stop offset="1" stopColor="#381B10" />
        </LinearGradient>
        <RadialGradient id={`${id}felt`} cx="45%" cy="35%" rx="70%" ry="80%">
          <Stop offset="0" stopColor={felt[0]} /><Stop offset="1" stopColor={felt[1]} />
        </RadialGradient>
        <Pattern id={`${id}grain`} width="36" height="18" patternUnits="userSpaceOnUse">
          <Path d="M0 3 Q18 8 36 3 M0 12 Q18 16 36 12" stroke="#D4A571" strokeWidth="0.6" opacity="0.2" fill="none" />
        </Pattern>
        <Pattern id={`${id}weave`} width="6" height="6" patternUnits="userSpaceOnUse">
          <Path d="M0 1 L2 1 M3 4 L5 4" stroke={monochrome ? colors.text : "#D8F0D5"} strokeWidth="0.5" opacity="0.09" />
        </Pattern>
        <ClipPath id={`${id}sceneryClip`}><Rect x="19" y="19" width="322" height="422" rx="148" /></ClipPath>
        <RadialGradient id={`${id}sceneryFade`} cx="50%" cy="50%" rx="65%" ry="65%">
          <Stop offset="0" stopColor={felt[1]} stopOpacity="0.85" />
          <Stop offset="0.55" stopColor={felt[1]} stopOpacity="0.65" />
          <Stop offset="1" stopColor={felt[1]} stopOpacity="0.15" />
        </RadialGradient>
      </Defs>
      <Rect x="3" y="3" width="354" height="454" rx="164" fill={monochrome ? colors.surfaceRaised : `url(#${id}wood)`} stroke={monochrome ? trim : "#38291D"} strokeWidth="3" />
      <Rect x="5" y="5" width="350" height="450" rx="162" fill={monochrome ? "none" : `url(#${id}grain)`} />
      <Rect x="15" y="15" width="330" height="430" rx="152" fill={`url(#${id}felt)`} stroke={trim} strokeWidth="2" />
      <Rect x="19" y="19" width="322" height="422" rx="148" fill={`url(#${id}weave)`} stroke={monochrome ? colors.borderSubtle : "#071F17"} strokeWidth="3" />
      {!!scenery && <>
        <Image testID={`table-scenery-${selected}`} href={scenery} x="19" y="19" width="322" height="422"
          preserveAspectRatio="xMidYMid slice" clipPath={`url(#${id}sceneryClip)`} opacity={themeId ? 0.8 : 0.48} />
        <Rect x="19" y="19" width="322" height="422" rx="148" fill={`url(#${id}sceneryFade)`} />
      </>}
      <Rect x="24" y="24" width="312" height="412" rx="143" fill="none" stroke={monochrome ? colors.text : "#B9D2AC"} strokeOpacity="0.18" strokeWidth="1" />
    </Svg>
  </View>;
}
