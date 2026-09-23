import { useState } from 'react';
import { Pressable, Text, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { fonts, gameControlFinish, useTheme } from '../theme';
import { useTableTheme } from '../TableThemeProvider';
import { RoomSheet } from './RoomSheet';
import { TableThemePicker } from './TableThemePicker';

export function ThemeAction() {
  const { colors } = useTheme();
  const { theme } = useTableTheme();
  const compact = useWindowDimensions().width < 900;
  const [open, setOpen] = useState(false);
  return <>
    <Pressable accessibilityRole="button" accessibilityLabel="Choose theme" accessibilityHint={`Current theme: ${theme.name}`} accessibilityState={{ expanded: open }} onPress={() => setOpen(true)}
      style={({ pressed }) => ({ ...gameControlFinish(colors, pressed), minWidth: 44, minHeight: 44, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 })}>
      <Ionicons name="color-palette-outline" size={22} color={colors.accent} />
      {!compact && <Text style={{ color: colors.text, fontFamily: fonts.medium }}>Theme</Text>}
    </Pressable>
    <RoomSheet visible={open} title="Choose theme" closeLabel="Close themes" testID="app-theme-sheet" presentation="dialog" onClose={() => setOpen(false)}>
      <TableThemePicker showTitle={false} />
    </RoomSheet>
  </>;
}
