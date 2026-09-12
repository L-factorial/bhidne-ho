import { StyleSheet, Text, View } from 'react-native';
import { physicalLabel, type MarriageMeld } from '../multiplayer/marriage';
import { colors, fonts } from '../theme';

export function MarriageMeldCards({ groups }: { groups: MarriageMeld[] }) {
  return <View style={styles.groups}>{groups.map((group, index) => <View key={index} style={styles.group}>
    <Text style={styles.label}>{group.meld_type === 'dublee' ? 'Dublee' : group.meld_type === 'tunnela' ? 'Tunnela' : 'Sequence'}</Text>
    <View style={styles.cards}>{group.card_ids.map(id => <View key={id} accessibilityLabel={physicalLabel(id)} style={styles.card}>
      <Text style={[styles.face, /[HD]$/.test(id) && { color: '#B13639' }]}>{physicalLabel(id).split(' · ')[0]}</Text>
      <Text style={styles.copy}>Copy {physicalLabel(id).split(' · ')[1]}</Text>
    </View>)}</View>
  </View>)}</View>;
}

const styles = StyleSheet.create({
  groups: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'center' },
  group: { gap: 6, borderWidth: 1, borderColor: '#537E68', borderRadius: 10, padding: 8, maxWidth: '100%' },
  label: { color: colors.champagne, fontFamily: fonts.medium, fontSize: 12 }, cards: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  card: { width: 44, height: 64, backgroundColor: colors.ivory, borderRadius: 6, borderWidth: 1, borderColor: '#D9C8B0', alignItems: 'center', justifyContent: 'space-around' },
  face: { color: '#162A42', fontSize: 21, fontWeight: 'bold' }, copy: { color: '#4B5660', fontSize: 9 },
});
