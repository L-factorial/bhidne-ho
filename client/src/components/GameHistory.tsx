import { ui, uiLabel } from '../i18n/copy.ts';
import { useUiLanguage } from '../i18n/useUiLanguage';
import { gameControlFinish, gameHeadingFinish, gamePanelFinish, fonts, useThemedStyles, type ThemeColors } from '../theme';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { RoomSnapshot } from '../screens/LiveGameTable';

const suits: Record<string, string> = { S: '♠', H: '♥', D: '♦', C: '♣' };
export function GameHistory({ snapshot }: { snapshot: RoomSnapshot }) {
  useUiLanguage();
  const name = (id: number) => snapshot.players?.find(p => p.player_id === id)?.display_name || ui("common.player_number", { "number": id });
  const styles = useThemedStyles(createStyles);
  const [tab, setTab] = useState<'tricks' | 'activity'>("tricks");
  const tricks = [...(snapshot.deal?.tricks || [])].filter(trick => trick.complete).reverse();
  const activity = [...(snapshot.log || [])].reverse();
  return <View style={styles.panel}>
    <Text accessibilityRole="header" style={styles.heading}>{ui("common.game_history")}</Text>
    <View style={styles.tabs}>
      {(["tricks", 'activity'] as const).map(value => <Pressable key={value} accessibilityRole="button"
        accessibilityState={{ selected: tab === value }} onPress={() => setTab(value)} style={[styles.tab, tab === value && styles.selected]}>
        <Text style={styles.label}>{value === 'tricks' ? ui("callbreak.deal_tricks", { "deal": snapshot.deal?.deal_number || 1 }) : ui("common.recent_activity")}</Text>
      </Pressable>)}
    </View>
    <ScrollView key={tab} testID="game-history-scroll" accessibilityLabel={tab === 'tricks' ? ui("callbreak.completed_trick_history") : ui("common.recent_game_activity")}
      nestedScrollEnabled showsVerticalScrollIndicator persistentScrollbar style={styles.scroll} contentContainerStyle={styles.entries}>
      {tab === 'tricks' ? tricks.length ? tricks.map(trick => <View key={trick.trick_number} style={styles.entry}>
        <Text style={styles.title}>{ui("callbreak.trick_number_player_won", { "number": trick.trick_number, "player": name(trick.winner!) })}</Text>
        <View style={styles.cards}>{trick.plays.map(play => <Text key={play.player_id} style={styles.text}>
          {name(play.player_id)}: {play.card.slice(0, -1)}{suits[play.card.slice(-1)]}
        </Text>)}</View>
      </View>) : <Text style={styles.text}>{ui("callbreak.completed_tricks_will_appear_here")}</Text>
        : activity.length ? activity.map((event, index) => <View key={`${event.revision}-${event.event}-${index}`} style={styles.entry}>
          <Text style={styles.title}>{uiLabel(event.event.replaceAll('_', ' '))}</Text>
          <Text style={styles.text}>{event.player_id ? `${name(event.player_id)} · ` : ''}{(event.action ? uiLabel(event.action.replaceAll('_', ' ')) : '') || ui("common.revision_number", { "number": event.revision })}</Text>
        </View>) : <Text style={styles.text}>{ui("common.no_activity_yet")}</Text>}
    </ScrollView>
    <Text style={styles.caption}>{tab === 'tricks' ? ui("common.current_deal_newest_first") : ui("common.recent_server_events_newest_first")}</Text>
  </View>;
}
const createStyles = (colors: ThemeColors) => StyleSheet.create({
  panel: { ...gamePanelFinish(colors), flex: 1, minHeight: 0, backgroundColor: colors.surface, padding: 14 }, heading: { ...gameHeadingFinish(colors), fontFamily: fonts.display, fontSize: 24, color: colors.text },
  tabs: { flexDirection: 'row', gap: 6, marginVertical: 10 }, tab: { ...gameControlFinish(colors), minHeight: 44, paddingHorizontal: 10, justifyContent: 'center', borderRadius: 7 }, selected: { backgroundColor: colors.surface }, label: { fontFamily: fonts.medium, fontSize: 11, color: colors.text },
  scroll: { flex: 1, minHeight: 0 }, entries: { paddingRight: 8, paddingBottom: 12, gap: 10 }, entry: { borderBottomWidth: 1, borderColor: colors.border, paddingVertical: 10, gap: 6 },
  title: { ...gameHeadingFinish(colors), fontFamily: fonts.medium, fontSize: 12, lineHeight: 19, color: colors.accent }, text: { fontFamily: fonts.body, fontSize: 11, lineHeight: 20, color: colors.textMuted }, cards: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 10 }, caption: { fontFamily: fonts.body, fontSize: 10, color: colors.textMuted, marginTop: 8 },
});
