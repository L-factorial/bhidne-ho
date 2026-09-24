import { ui } from '../i18n/copy.ts';
import { useUiLanguage } from '../i18n/useUiLanguage';
import { StyleSheet, Text, View } from 'react-native';
import { physicalLabel, type MarriageWinningMeld } from '../multiplayer/marriage';
import { fonts, useTheme, useThemedStyles, type ThemeColors } from '../theme';

export function MarriageMeldCards({ groups, hideLabels = false }: { groups: MarriageWinningMeld[]; hideLabels?: boolean }) {
  useUiLanguage();
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  return <View style={styles.groups}>{groups.map((group, index) => <View key={index} style={styles.group}>
    {!hideLabels && <Text style={styles.label}>{group.meld_type === 'dublee' ? ui("marriage.dublee") : group.meld_type === 'tunnela' ? ui("marriage.tunnela") : group.meld_type === 'set' ? ui("marriage.set") : group.meld_type === 'sequence' ? ui("marriage.sequence_wildcards") : ui("marriage.sequence")}</Text>}
    <View style={styles.cards}>{group.card_ids.map(id => <View key={id} accessibilityLabel={physicalLabel(id)} style={styles.card}>
      <Text style={[styles.face, /[HD]$/.test(id) && { color: colors.cardRed }]}>{physicalLabel(id).split(' · ')[0]}</Text>
      <Text style={styles.copy}>{ui("common.copy_copynumber", { "copyNumber": physicalLabel(id).split(' · ')[1] })}</Text>
    </View>)}</View>
  </View>)}</View>;
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  groups: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'center' },
  group: { gap: 6, borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 8, maxWidth: '100%' },
  label: { color: colors.accent, fontFamily: fonts.medium, fontSize: 12 }, cards: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  card: { width: 44, height: 64, backgroundColor: colors.cardFace, borderRadius: 6, borderWidth: 1, borderColor: colors.cardBorder, alignItems: 'center', justifyContent: 'space-around' },
  face: { fontFamily: fonts.medium, color: colors.cardInk, fontSize: 21, fontWeight: 'bold' }, copy: { color: colors.cardInk, fontSize: 9 },
});
