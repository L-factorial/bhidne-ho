import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { RoomSnapshot } from '../screens/LiveGameTable';
import { colors, fonts } from '../theme';

const suits: Record<string, string> = { S: '♠', H: '♥', D: '♦', C: '♣' };
export function GameHistory({ snapshot }: { snapshot: RoomSnapshot }) {
  const [tab, setTab] = useState<'tricks' | 'activity'>('tricks');
  const tricks = [...(snapshot.deal?.tricks || [])].filter(trick => trick.complete).reverse();
  const activity = [...(snapshot.log || [])].reverse();
  return <View style={styles.panel}>
    <Text accessibilityRole="header" style={styles.heading}>Game history</Text>
    <View style={styles.tabs}>
      {(['tricks', 'activity'] as const).map(value => <Pressable key={value} accessibilityRole="button"
        accessibilityState={{ selected: tab === value }} onPress={() => setTab(value)} style={[styles.tab, tab === value && styles.selected]}>
        <Text style={styles.label}>{value === 'tricks' ? `Deal ${snapshot.deal?.deal_number || 1} tricks` : 'Recent activity'}</Text>
      </Pressable>)}
    </View>
    <ScrollView key={tab} testID="game-history-scroll" accessibilityLabel={tab === 'tricks' ? 'Completed trick history' : 'Recent game activity'}
      nestedScrollEnabled showsVerticalScrollIndicator persistentScrollbar style={styles.scroll} contentContainerStyle={styles.entries}>
      {tab === 'tricks' ? tricks.length ? tricks.map(trick => <View key={trick.trick_number} style={styles.entry}>
        <Text style={styles.title}>Trick {trick.trick_number} · Player {trick.winner} won</Text>
        <View style={styles.cards}>{trick.plays.map(play => <Text key={play.player_id} style={styles.text}>
          P{play.player_id}: {play.card.slice(0, -1)}{suits[play.card.slice(-1)]}
        </Text>)}</View>
      </View>) : <Text style={styles.text}>Completed tricks will appear here.</Text>
        : activity.length ? activity.map((event, index) => <View key={`${event.revision}-${event.event}-${index}`} style={styles.entry}>
          <Text style={styles.title}>{event.event === 'AutoAction' ? 'Automatic action' : event.event.replaceAll('_', ' ').toLowerCase()}</Text>
          <Text style={styles.text}>{event.player_id ? `Player ${event.player_id} · ` : ''}{event.action?.replaceAll('_', ' ').toLowerCase() || `Revision ${event.revision}`}</Text>
        </View>) : <Text style={styles.text}>No activity yet.</Text>}
    </ScrollView>
    <Text style={styles.caption}>{tab === 'tricks' ? 'Current deal · newest first' : 'Recent server events · newest first'}</Text>
  </View>;
}
const styles = StyleSheet.create({
  panel: { flex: 1, minHeight: 0, backgroundColor: '#11273C', padding: 14 }, heading: { fontFamily: fonts.display, fontSize: 24, color: colors.ivory },
  tabs: { flexDirection: 'row', gap: 6, marginVertical: 10 }, tab: { minHeight: 44, paddingHorizontal: 10, justifyContent: 'center', borderRadius: 7 }, selected: { backgroundColor: '#294159' }, label: { fontFamily: fonts.medium, fontSize: 11, color: colors.ivory },
  scroll: { flex: 1, minHeight: 0 }, entries: { paddingRight: 8, paddingBottom: 12, gap: 10 }, entry: { borderBottomWidth: 1, borderColor: '#FFFFFF19', paddingVertical: 10, gap: 6 },
  title: { fontFamily: fonts.medium, fontSize: 12, lineHeight: 19, color: colors.champagne }, text: { fontFamily: fonts.body, fontSize: 11, lineHeight: 20, color: '#C1CBD5' }, cards: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 10 }, caption: { fontFamily: fonts.body, fontSize: 10, color: '#A7B7C8', marginTop: 8 },
});
