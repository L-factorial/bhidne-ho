import { Pressable, Text, View } from 'react-native';
import { fonts, useTheme } from '../theme';
import { useTableTheme } from '../TableThemeProvider';
import { tableThemes, type TableThemeId } from '../tableThemes';
import { TableSurface } from './TableSurface';

export function TableThemePicker({ showTitle = true }: { showTitle?: boolean }) {
  const { colors } = useTheme();
  const { id, select } = useTableTheme();
  return <View testID="table-theme-picker" style={{ gap: 8, paddingVertical: 12 }}>
    {showTitle && <Text accessibilityRole="header" style={{ color: colors.text, fontFamily: fonts.medium, fontSize: 16 }}>Table theme</Text>}
    <Text style={{ color: colors.textMuted, fontFamily: fonts.body, fontSize: 12 }}>Your view · saved on this device</Text>
    {(Object.keys(tableThemes) as TableThemeId[]).map(key => <Pressable key={key} accessibilityRole="radio" accessibilityLabel={tableThemes[key].name}
      accessibilityState={{ checked: id === key }} onPress={() => select(key)} testID={`table-theme-${key}`}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10, minHeight: 76, borderRadius: 12, borderWidth: 2, borderColor: id === key ? colors.tableTrim : colors.borderSubtle, backgroundColor: colors.surfaceRaised }}>
      <View pointerEvents="none" style={{ width: 48, height: 60 }}><TableSurface themeId={key} /></View>
      <View style={{ flex: 1, gap: 3 }}><Text style={{ color: colors.text, fontFamily: fonts.medium }}>{tableThemes[key].name}{id === key ? ' ✓' : ''}</Text>
        <Text style={{ color: colors.textMuted, fontFamily: fonts.body, fontSize: 12 }}>{tableThemes[key].description}</Text></View>
    </Pressable>)}
  </View>;
}
