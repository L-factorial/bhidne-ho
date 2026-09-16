import { type ReactNode, useState } from 'react';
import { Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { BrandIcon } from './BrandArt';
import { ThemeToggle } from './ThemeToggle';
import { fonts, useTheme } from '../theme';

export function GameTableHeader({ title, path, game, onBack, endControl, children }: {
  title: string; path?: string; game: string; onBack: () => void; endControl?: ReactNode; children?: ReactNode;
}) {
  const { colors } = useTheme();
  const mobile = useWindowDimensions().width < 900;
  const [open, setOpen] = useState(false);
  return <>
    <View testID={`${game}-header`} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, padding: 8, borderBottomWidth: 1, borderColor: colors.border }}>
      <BrandIcon size={mobile ? 30 : 48} />
      <View style={{ flex: 1 }}><Text accessibilityRole="header" style={{ fontFamily: fonts.medium, fontSize: mobile ? 17 : 20, color: colors.text }}>{title}</Text>
        {!!path && <Text numberOfLines={1} style={{ fontFamily: fonts.body, fontSize: 11, color: colors.textMuted }}>{path}</Text>}
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel="Table menu" accessibilityState={{ expanded: open }} onPress={() => setOpen(v => !v)}
        style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}>
        <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ gap: 5 }}>
          {[0, 1, 2].map(line => <View key={line} style={{ width: 22, height: 2, borderRadius: 1, backgroundColor: colors.text }} />)}
        </View>
      </Pressable>
    </View>
    {open && <ScrollView testID={`${game}-menu`} style={{ maxHeight: '40%', flexGrow: 0 }} contentContainerStyle={{ padding: 8, gap: 8 }} nestedScrollEnabled>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back to room" onPress={onBack} style={{ padding: 12, minHeight: 44, borderRadius: 8, backgroundColor: colors.surfaceRaised }}>
          <Text style={{ color: colors.text, fontFamily: fonts.body }}>Back to room</Text>
        </Pressable><ThemeToggle />
      </View>
      {children}
      <View style={{ borderTopWidth: 1, borderColor: colors.border, paddingTop: 4 }}>{endControl}</View>
    </ScrollView>}
  </>;
}
