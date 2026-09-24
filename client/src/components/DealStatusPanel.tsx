import { ui } from '../i18n/copy.ts';
import { useUiLanguage } from '../i18n/useUiLanguage';
import { useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { TablePlayer } from './CardTable';
import { fonts, useThemedStyles, type ThemeColors } from '../theme';

export function DealStatusPanel({ players, viewerId, activePlayerId, cardsPlayed, paused, trickNumber = 1, complete = false }: {
  players: TablePlayer[]; viewerId: string; activePlayerId: string; cardsPlayed: number; paused: boolean;
  trickNumber?: number; complete?: boolean;
}) {
  useUiLanguage();
  const styles = useThemedStyles(createStyles);
  const [expanded, setExpanded] = useState(false);
  const [offset, setOffset] = useState(0);
  const [viewportWidth, setViewportWidth] = useState(0);
  const [contentWidth, setContentWidth] = useState(0);
  const scroll = useRef<ScrollView>(null);
  const active = players.find(player => player.id === activePlayerId);
  const remaining = Math.max(0, contentWidth - viewportWidth);
  const tricksPerDeal = players.length === 4 ? 13 : 10;

  return <View style={styles.panel}>
    <View style={styles.headingRow}>
      <Text accessibilityRole="header" style={styles.heading}>{ui("callbreak.current_deal")}</Text>
      <Text style={styles.deal}>1 / 5</Text>
    </View>
    <Text accessibilityLiveRegion="polite" style={styles.status}>{ui("callbreak.deal_summary", { "status": complete ? ui("callbreak.deal_complete") : paused ? ui("common.preview_paused") : ui("rooms.playing"), "trick": trickNumber, "total": tricksPerDeal, "played": cardsPlayed, "players": players.length })}</Text>
    <Text style={styles.detail}>{ui("callbreak.tricks_completed", { "status": complete ? ui("callbreak.all_hands_played") : `${paused ? ui("callbreak.next_turn") : ui("common.current_turn")}: ${active?.id === viewerId ? ui("common.you") : active?.name}`, "completed": players.reduce((sum, player) => sum + player.tricks, 0), "total": tricksPerDeal })}</Text>
    <Pressable accessibilityRole="button" accessibilityState={{ expanded }}
      onPress={() => { setExpanded(value => !value); setOffset(0); }} style={styles.toggle}>
      <Text style={styles.toggleText}>{expanded ? ui("callbreak.hide_bids_and_player_status") : ui("callbreak.view_bids_and_player_status")}</Text>
      <Text style={styles.toggleText}>{expanded ? '−' : '+'}</Text>
    </Pressable>
    {expanded && <>
      <View style={styles.scrollHeader}>
        <Text style={styles.detail}>{ui("callbreak.bids_total", { "bids": players.reduce((sum, player) => sum + player.bid, 0), "available": tricksPerDeal })}</Text>
        <View style={styles.arrows}>
          <Pressable accessibilityRole="button" accessibilityLabel={ui("callbreak.previous_bids")} disabled={offset <= 1}
            accessibilityState={{ disabled: offset <= 1 }} onPress={() => scroll.current?.scrollTo({ x: Math.max(0, offset - 164), animated: true })}
            style={[styles.arrow, offset <= 1 && styles.disabled]}><Text style={styles.toggleText}>←</Text></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={ui("callbreak.next_bids")} disabled={offset >= remaining - 1}
            accessibilityState={{ disabled: offset >= remaining - 1 }} onPress={() => scroll.current?.scrollTo({ x: Math.min(remaining, offset + 164), animated: true })}
            style={[styles.arrow, offset >= remaining - 1 && styles.disabled]}><Text style={styles.toggleText}>→</Text></Pressable>
        </View>
      </View>
      <ScrollView ref={scroll} horizontal showsHorizontalScrollIndicator accessibilityLabel={ui("callbreak.current_deal_player_bids")}
        onLayout={event => setViewportWidth(event.nativeEvent.layout.width)}
        onContentSizeChange={width => setContentWidth(width)} onScroll={event => setOffset(event.nativeEvent.contentOffset.x)} scrollEventThrottle={16}
        contentContainerStyle={styles.bidList}>
        {players.map(player => <View key={player.id} testID={`bid-${player.id}`} style={[styles.bidCard, player.id === activePlayerId && styles.active]}>
          <Text numberOfLines={1} style={styles.player}>{player.id === viewerId ? ui("common.you") : player.name}</Text>
          <Text style={styles.bid}>{ui("callbreak.bid_count", { "count": player.bid })}</Text>
          <Text style={styles.detail}>{ui("callbreak.won_won_need_needed", { "won": player.tricks, "needed": Math.max(0, player.bid - player.tricks) })}</Text>
          <Text style={styles.detail}>{ui("common.count_cards_left", { "count": player.cardsRemaining })}</Text>
          <Text style={styles.turn}>{player.id === activePlayerId ? paused ? ui("callbreak.next_turn") : ui("common.current_turn") : ui("rooms.waiting")}</Text>
        </View>)}
      </ScrollView>
      <Text style={styles.hint}>Swipe or use the arrows to see every player’s bid.</Text>
    </>}
  </View>;
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  panel: { backgroundColor: colors.surfaceSelected, borderWidth: 1, borderColor: colors.textMuted, borderRadius: 12, padding: 14, marginTop: 16 },
  headingRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, heading: { fontFamily: fonts.display, fontSize: 24, color: colors.text }, deal: { fontFamily: fonts.medium, fontSize: 12, color: colors.accent },
  status: { fontFamily: fonts.medium, fontSize: 12, lineHeight: 20, color: colors.text, marginTop: 6 }, detail: { fontFamily: fonts.body, fontSize: 11, lineHeight: 20, color: colors.textMuted },
  toggle: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 6 }, toggleText: { fontFamily: fonts.medium, fontSize: 12, color: colors.accent },
  scrollHeader: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 8 }, arrows: { flexDirection: 'row', gap: 6 },
  arrow: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.textMuted, borderRadius: 8 }, disabled: { opacity: 0.35 },
  bidList: { gap: 10, paddingVertical: 12 }, bidCard: { width: 154, padding: 12, borderRadius: 10, borderWidth: 1, borderColor: colors.textMuted, backgroundColor: colors.background }, active: { borderColor: colors.turnText },
  player: { fontFamily: fonts.medium, fontSize: 12, color: colors.text }, bid: { fontFamily: fonts.display, fontSize: 26, color: colors.accent, marginVertical: 5 }, turn: { fontFamily: fonts.medium, fontSize: 10, color: colors.accent, marginTop: 8 }, hint: { fontFamily: fonts.body, fontSize: 10, lineHeight: 17, color: colors.textMuted },
});
