import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { fonts, useTheme } from '../theme';

export function LobbyNavigation({ selected, onSelect }: { selected: 'home' | 'games' | 'friends'; onSelect: (tab: 'home' | 'games' | 'friends' | 'profile') => void }) {
  const { colors: c } = useTheme();
  const insets = useSafeAreaInsets();
  const items = [
    { key: 'home', label: 'Home', icon: 'home', outline: 'home-outline' },
    { key: 'games', label: 'Games', icon: 'layers', outline: 'layers-outline' },
    { key: 'friends', label: 'Friends', icon: 'people', outline: 'people-outline' },
    { key: 'profile', label: 'Profile', icon: 'person', outline: 'person-outline' },
  ] as const;
  return <View testID="lobby-navigation" style={{ backgroundColor: c.surface, borderTopWidth: 1, borderColor: c.borderSubtle,
    paddingBottom: Math.max(insets.bottom, 8), paddingTop: 6, paddingHorizontal: 8 }}>
    <View style={{ flexDirection: 'row', alignSelf: 'center', width: '100%', maxWidth: 680 }}>
      {items.map(item => <Pressable key={item.key} accessibilityRole="tab" accessibilityLabel={item.label}
        accessibilityState={{ selected: selected === item.key }} onPress={() => onSelect(item.key)}
        style={({ pressed }) => ({ flex: 1, minHeight: 52, justifyContent: 'center', alignItems: 'center', gap: 3, borderRadius: 12, backgroundColor: pressed ? c.surfaceRaised : 'transparent' })}>
        <Ionicons name={selected === item.key ? item.icon : item.outline} size={23} color={selected === item.key ? c.accent : c.textMuted} />
        <Text style={{ fontFamily: fonts.medium, fontSize: 10, color: selected === item.key ? c.accent : c.textMuted }}>{item.label}</Text>
      </Pressable>)}
    </View>
  </View>;
}
