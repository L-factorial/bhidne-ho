import { ui } from '../i18n/copy.ts';
import { useUiLanguage } from '../i18n/useUiLanguage';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { fonts, useTheme } from '../theme';

export function LobbyNavigation({ selected, onSelect }: { selected: 'home' | 'games' | 'friends'; onSelect: (tab: 'home' | 'games' | 'friends' | 'profile') => void }) {
  useUiLanguage();
  const { colors: c } = useTheme();
  const insets = useSafeAreaInsets();
  const items = [
    { key: 'home', label: ui('common.home'), icon: 'home', outline: 'home-outline' },
    { key: 'games', label: ui('common.games'), icon: 'layers', outline: 'layers-outline' },
    { key: 'friends', label: ui('common.friends'), icon: 'people', outline: 'people-outline' },
    { key: 'profile', label: ui('common.profile'), icon: 'person', outline: 'person-outline' },
  ] as const;
  return <View testID="lobby-navigation" style={{ backgroundColor: c.surface, borderTopWidth: 1, borderColor: c.border, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingBottom: Math.max(insets.bottom, 8), paddingHorizontal: Math.max(12, insets.left, insets.right) }}>
    <View style={{ flexDirection: 'row', alignSelf: 'center', width: '100%', maxWidth: 720 }}>
      {items.map(item => <Pressable key={item.key} accessibilityRole="tab" accessibilityLabel={item.label}
        accessibilityState={{ selected: selected === item.key }} onPress={() => onSelect(item.key)}
        style={({ pressed }) => ({ flex: 1, minHeight: 64, justifyContent: 'center', alignItems: 'center', gap: 4,
          opacity: pressed ? 0.7 : 1 })}>
        <Ionicons name={item.outline} size={21} color={selected === item.key ? c.accent : c.textMuted} />
        <Text style={{ fontFamily: fonts.medium, fontSize: 11, color: selected === item.key ? c.accent : c.textMuted }}>{item.label}</Text>
      </Pressable>)}
    </View>
  </View>;
}
