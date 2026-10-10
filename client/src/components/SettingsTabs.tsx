import { Pressable, View, useWindowDimensions } from 'react-native';
import { AppText as Text } from './AppText';
import { fonts, radii, useTheme } from '../theme';

export function SettingsTabs<T extends string>({ tabs, selected, onSelect }: {
  tabs: readonly { id: T; label: string }[]; selected: T; onSelect: (id: T) => void;
}) {
  const { colors } = useTheme();
  const {fontScale} = useWindowDimensions();
  return <View accessibilityRole="tablist" style={{ flexDirection: 'row', flexWrap: 'wrap', padding: 8, gap: 6, flexShrink: 0 }}>
    {tabs.map(tab => <Pressable key={tab.id} accessibilityRole="tab" accessibilityLabel={tab.label}
      accessibilityState={{ selected: selected === tab.id }} aria-selected={selected === tab.id}
      onPress={() => onSelect(tab.id)} style={{ flexGrow: 1, flexBasis: 120 * fontScale, maxWidth: '100%', minWidth: 0, minHeight: 48, justifyContent: 'center', alignItems: 'center',
        padding: 8, borderRadius: radii.medium, backgroundColor: selected === tab.id ? colors.surfaceSelected : colors.surface,
        borderBottomWidth: 2, borderBottomColor: selected === tab.id ? colors.accent : 'transparent' }}>
      <Text style={{ color: selected === tab.id ? colors.accent : colors.text, fontFamily: fonts.medium, textAlign: 'center' }}>{tab.label}</Text>
    </Pressable>)}
  </View>;
}

export type RulesTab = 'rules' | 'bets';
