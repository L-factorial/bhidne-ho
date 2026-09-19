import { Pressable, Text, View } from 'react-native';
import { fonts, useTheme } from '../theme';

export function EndedTableNotice({ onBack, onNewGame }: { onBack: () => void; onNewGame: () => void }) {
  const { colors } = useTheme();
  return <View testID="ended-table-notice" style={{ width: '100%', maxWidth: 320, padding: 10, gap: 6, borderRadius: 16, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, alignItems: 'center' }}>
    <Text accessibilityRole="header" style={{ color: colors.text, fontFamily: fonts.medium, fontSize: 18 }}>Table ended</Text>
    <Text style={{ color: colors.textMuted, fontFamily: fonts.body, fontSize: 12, textAlign: 'center' }}>This table is closed. The room is still open.</Text>
    <View style={{ flexDirection: 'row', gap: 8 }}>
    <Pressable accessibilityRole="button" accessibilityLabel="Back to room" onPress={onBack} style={{ flex: 1, minHeight: 44, justifyContent: 'center' }}><Text style={{ color: colors.accent, fontFamily: fonts.medium, fontSize: 12, textAlign: 'center' }}>Back to room</Text></Pressable>
    <Pressable accessibilityRole="button" accessibilityLabel="Start a new table" onPress={onNewGame} style={{ flex: 1, minHeight: 44, justifyContent: 'center' }}><Text style={{ color: colors.accent, fontFamily: fonts.medium, fontSize: 12, textAlign: 'center' }}>Start a new table</Text></Pressable>
    </View>
  </View>;
}
