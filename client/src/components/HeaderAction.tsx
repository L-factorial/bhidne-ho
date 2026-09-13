import { Pressable, Text } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { fonts, useTheme } from '../theme';

export function HeaderAction({ icon, label, onPress, compact = false }: {
  icon: 'profile' | 'leave'; label: string; onPress: () => void; compact?: boolean;
}) {
  const { colors } = useTheme();
  const color = icon === 'leave' ? colors.textMuted : colors.accent;
  return <Pressable accessibilityRole="button" accessibilityLabel={icon === 'profile' ? 'Open profile' : label}
    onPress={onPress} style={({ pressed }) => ({ minWidth: 44, minHeight: 44, paddingHorizontal: compact ? 10 : 14,
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 12,
      borderWidth: 1, borderColor: colors.border, backgroundColor: pressed ? colors.surfaceSelected : colors.surface,
    })}>
    <Svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8} accessible={false}>
      {icon === 'profile' ? <><Circle cx={12} cy={8} r={3.5} /><Path d="M4.5 21v-2a7.5 7.5 0 0 1 15 0v2" strokeLinecap="round" /></>
        : <><Path d="M10 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h5M10 12h11m-4-4 4 4-4 4" strokeLinecap="round" strokeLinejoin="round" /></>}
    </Svg>
    {!compact && <Text style={{ color, fontFamily: fonts.medium, fontSize: 13 }}>{label}</Text>}
  </Pressable>;
}
