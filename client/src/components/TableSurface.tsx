import { useId } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Defs, LinearGradient, Pattern, Path, RadialGradient, Rect, Stop } from 'react-native-svg';

/** Decorative only: seat geometry, hit targets and game state remain owned by the table. */
export function TableSurface({ game = 'callbreak' }: { game?: 'callbreak' | 'marriage' | 'flush' }) {
  const id = useId().replace(/:/g, '');
  const felt = game === 'flush' ? ['#175A72', '#072D40'] : game === 'marriage' ? ['#4C6345', '#203C2C'] : ['#176C46', '#053723'];
  return <View pointerEvents="none" accessible={false} style={StyleSheet.absoluteFill} testID={`table-surface-${game}`}>
    <Svg width="100%" height="100%" viewBox="0 0 360 460" preserveAspectRatio="none">
      <Defs>
        <LinearGradient id={`${id}wood`} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#9A6A3E" /><Stop offset="0.28" stopColor="#49301E" />
          <Stop offset="0.55" stopColor="#805333" /><Stop offset="1" stopColor="#302116" />
        </LinearGradient>
        <RadialGradient id={`${id}felt`} cx="45%" cy="35%" rx="70%" ry="80%">
          <Stop offset="0" stopColor={felt[0]} /><Stop offset="1" stopColor={felt[1]} />
        </RadialGradient>
        <Pattern id={`${id}grain`} width="36" height="18" patternUnits="userSpaceOnUse">
          <Path d="M0 3 Q18 8 36 3 M0 12 Q18 16 36 12" stroke="#D4A571" strokeWidth="0.6" opacity="0.2" fill="none" />
        </Pattern>
        <Pattern id={`${id}weave`} width="6" height="6" patternUnits="userSpaceOnUse">
          <Path d="M0 1 L2 1 M3 4 L5 4" stroke="#D8F0D5" strokeWidth="0.5" opacity="0.09" />
        </Pattern>
      </Defs>
      <Rect x="3" y="3" width="354" height="454" rx="106" fill={`url(#${id}wood)`} stroke="#38291D" strokeWidth="3" />
      <Rect x="5" y="5" width="350" height="450" rx="104" fill={`url(#${id}grain)`} />
      <Rect x="15" y="15" width="330" height="430" rx="94" fill={`url(#${id}felt)`} stroke="#B88A53" strokeWidth="2" />
      <Rect x="19" y="19" width="322" height="422" rx="90" fill={`url(#${id}weave)`} stroke="#071F17" strokeWidth="3" />
      <Rect x="24" y="24" width="312" height="412" rx="85" fill="none" stroke="#B9D2AC" strokeOpacity="0.18" strokeWidth="1" />
    </Svg>
  </View>;
}
