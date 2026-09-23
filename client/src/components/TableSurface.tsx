import { useId } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, G, LinearGradient, Pattern, Path, RadialGradient, Rect, Stop } from 'react-native-svg';
import { useTableTheme } from '../TableThemeProvider';
import { tableThemes, type TableThemeId } from '../tableThemes';

/** Decorative only: seat geometry, hit targets and game state remain owned by the table. */
export function TableSurface({ game = 'callbreak', themeId }: { game?: 'callbreak' | 'marriage' | 'flush'; themeId?: TableThemeId }) {
  const id = useId().replace(/:/g, '');
  const preference = useTableTheme();
  const selected = themeId || preference.id;
  const { felt, trim } = tableThemes[selected];
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
          <Path d="M0 1 L2 1 M3 4 L5 4" stroke="#D8F0D5" strokeWidth="0.5" opacity="0.09" />
        </Pattern>
        <Pattern id={`${id}straw`} width="18" height="18" patternUnits="userSpaceOnUse">
          <Path d="M1 0 L4 18 M8 0 L6 18 M12 0 L16 18 M0 7 L18 9 M0 14 L18 12" stroke="#E3C18A" strokeWidth="0.7" opacity="0.13" />
        </Pattern>
      </Defs>
      <Rect x="3" y="3" width="354" height="454" rx="164" fill={`url(#${id}wood)`} stroke="#38291D" strokeWidth="3" />
      <Rect x="5" y="5" width="350" height="450" rx="162" fill={`url(#${id}grain)`} />
      <Rect x="15" y="15" width="330" height="430" rx="152" fill={`url(#${id}felt)`} stroke={trim} strokeWidth="2" />
      <Rect x="19" y="19" width="322" height="422" rx="148" fill={`url(#${id}weave)`} stroke="#071F17" strokeWidth="3" />
      <Rect x="24" y="24" width="312" height="412" rx="143" fill="none" stroke="#B9D2AC" strokeOpacity="0.18" strokeWidth="1" />
      {selected === 'heritage' && <>
        <Rect x="24" y="24" width="312" height="412" rx="143" fill={`url(#${id}straw)`} />
        <G opacity="0.55" transform="translate(70 310)">
          <Path d="M0 63 Q45 48 94 62 T220 63" stroke="#C8AB79" fill="none" strokeWidth="2" />
          <Rect x="27" y="16" width="66" height="45" fill="#B77D50" />
          <Path d="M18 19 L59 -9 L103 19 Z" fill="#BFA06B" stroke="#E4C386" />
          <Path d="M29 15 L59 -5 M42 15 L61 -5 M57 15 L63 -4 M73 15 L65 -3 M89 15 L67 -2" stroke="#715033" />
          <Rect x="54" y="35" width="15" height="26" fill="#38251B" />
          <Path d="M34 29 H45 V41 H34 Z M76 29 H87 V41 H76 Z" fill="#38251B" />
          <Path d="M2 61 Q2 37 15 28 Q28 40 27 61 Z" fill="#D0AC62" />
          <Path d="M9 59 L15 34 L20 59 M5 51 H24" stroke="#856431" fill="none" />
          <Rect x="133" y="54" width="74" height="8" rx="3" fill="#A2957F" />
          <Rect x="141" y="48" width="57" height="7" rx="3" fill="#C5B396" />
          <Path d="M168 49 L168 5 M168 27 L152 12 M169 20 L183 5" stroke="#BC9362" strokeWidth="6" />
          <Circle cx="150" cy="2" r="22" fill="#788050" /><Circle cx="185" cy="-2" r="24" fill="#7D8856" /><Circle cx="167" cy="-19" r="25" fill="#939562" />
        </G>
      </>}
      {selected === 'dusk' && <G opacity="0.45">
        <Circle cx="218" cy="73" r="16" fill="#E9D9B6" />
        <Path d="M75 147 L126 72 L164 119 L201 89 L282 164 Z" fill="#8B96B2" />
        <Path d="M107 101 L126 72 L146 98 L131 92 L123 100 L118 93 Z M183 111 L201 89 L222 109 L206 104 L199 111 L195 103 Z" fill="#F0E9DF" />
        <Path d="M60 162 L112 125 L159 156 L217 122 L301 177 Z" fill="#536080" />
      </G>}
    </Svg>
  </View>;
}
