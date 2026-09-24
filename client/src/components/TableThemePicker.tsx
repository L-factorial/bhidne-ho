import { ui, uiLabel } from '../i18n/copy.ts';
import { useUiLanguage } from '../i18n/useUiLanguage';
import { Pressable, Text, View } from 'react-native';
import { fonts, useTheme } from '../theme';
import { useTableTheme } from '../TableThemeProvider';
import { tableThemes, type TableThemeId } from '../tableThemes';
import { TableSurface } from './TableSurface';

export function TableThemePicker({ showTitle = true }: { showTitle?: boolean }) {
  useUiLanguage();
  const { colors } = useTheme();
  const { id, select } = useTableTheme();
  return <View testID="table-theme-picker" style={{ gap: 8, paddingVertical: 12 }}>
    {showTitle && <Text accessibilityRole="header" style={{ color: colors.text, fontFamily: fonts.medium, fontSize: 16 }}>{ui("common.table_theme")}</Text>}
    <Text style={{ color: colors.textMuted, fontFamily: fonts.body, fontSize: 12 }}>{ui("common.across_the_app_saved_on_this_device")}</Text>
    {(Object.keys(tableThemes) as TableThemeId[]).map(key => <Pressable key={key} accessibilityRole="radio" accessibilityLabel={uiLabel(tableThemes[key].name, 'common')}
      accessibilityState={{ checked: id === key }} onPress={() => select(key)} testID={`table-theme-${key}`}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10, minHeight: 76, borderRadius: 12, borderWidth: 2, borderColor: id === key ? colors.tableTrim : colors.borderSubtle, backgroundColor: colors.surfaceRaised }}>
      <View pointerEvents="none" style={{ width: 48, height: 60 }}><TableSurface themeId={key} /></View>
      <View style={{ flex: 1, gap: 3 }}><Text style={{ color: colors.text, fontFamily: fonts.medium }}>{uiLabel(tableThemes[key].name, 'common')}{id === key ? ' ✓' : ''}</Text>
        <Text style={{ color: colors.textMuted, fontFamily: fonts.body, fontSize: 12 }}>{uiLabel(tableThemes[key].description, 'common')}</Text></View>
    </Pressable>)}
  </View>;
}
