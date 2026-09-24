import { ui } from '../i18n/copy.ts';
import { useUiLanguage } from '../i18n/useUiLanguage';
import { Pressable, Text, View } from 'react-native';
import { fonts, useTheme } from '../theme';

export function EndedTableNotice({ onBack, onNewGame }: { onBack: () => void; onNewGame: () => void }) {
  useUiLanguage();
  const { colors } = useTheme();
  return <View testID="ended-table-notice" style={{ width: '100%', maxWidth: 320, padding: 10, gap: 6, borderRadius: 16, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, alignItems: 'center' }}>
    <Text accessibilityRole="header" style={{ color: colors.text, fontFamily: fonts.medium, fontSize: 18 }}>{ui("rooms.table_ended")}</Text>
    <Text style={{ color: colors.textMuted, fontFamily: fonts.body, fontSize: 12, textAlign: 'center' }}>{ui("rooms.this_table_is_closed_the_room_is_still_open")}</Text>
    <View style={{ flexDirection: 'row', gap: 8 }}>
    <Pressable accessibilityRole="button" accessibilityLabel={ui("common.back_to_room")} onPress={onBack} style={{ flex: 1, minHeight: 44, justifyContent: 'center' }}><Text style={{ color: colors.accent, fontFamily: fonts.medium, fontSize: 12, textAlign: 'center' }}>{ui("common.back_to_room")}</Text></Pressable>
    <Pressable accessibilityRole="button" accessibilityLabel={ui("rooms.start_a_new_table")} onPress={onNewGame} style={{ flex: 1, minHeight: 44, justifyContent: 'center' }}><Text style={{ color: colors.accent, fontFamily: fonts.medium, fontSize: 12, textAlign: 'center' }}>{ui("rooms.start_a_new_table")}</Text></Pressable>
    </View>
  </View>;
}
