import { useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { TablePlayer } from './CardTable';
import { fonts, useThemedStyles, type ThemeColors } from '../theme';

export function DealStatusPanel({ players, viewerId, activePlayerId, cardsPlayed, paused, trickNumber = 1, complete = false }: {
  players: TablePlayer[]; viewerId: string; activePlayerId: string; cardsPlayed: number; paused: boolean;
  trickNumber?: number; complete?: boolean;
}) {
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
      <Text accessibilityRole="header" style={styles.heading}>Current deal</Text>
      <Text style={styles.deal}>1 / 5</Text>
    </View>
    <Text accessibilityLiveRegion="polite" style={styles.status}>
      {complete ? 'Deal complete' : paused ? 'Preview paused' : 'Playing'} · Trick {trickNumber} of {tricksPerDeal} · {cardsPlayed}/{players.length} cards played
    </Text>
    <Text style={styles.detail}>{complete ? 'All hands played' : `${paused ? 'Next turn' : 'Current turn'}: ${active?.id === viewerId ? 'You' : active?.name}`} · {players.reduce((sum, player) => sum + player.tricks, 0)}/{tricksPerDeal} tricks completed</Text>
    <Pressable accessibilityRole="button" accessibilityState={{ expanded }}
      onPress={() => { setExpanded(value => !value); setOffset(0); }} style={styles.toggle}>
      <Text style={styles.toggleText}>{expanded ? 'Hide bids and player status' : 'View bids and player status'}</Text>
      <Text style={styles.toggleText}>{expanded ? '−' : '+'}</Text>
    </Pressable>
    {expanded && <>
      <View style={styles.scrollHeader}>
        <Text style={styles.detail}>Bids · {players.reduce((sum, player) => sum + player.bid, 0)} total / {tricksPerDeal} available tricks</Text>
        <View style={styles.arrows}>
          <Pressable accessibilityRole="button" accessibilityLabel="Previous bids" disabled={offset <= 1}
            accessibilityState={{ disabled: offset <= 1 }} onPress={() => scroll.current?.scrollTo({ x: Math.max(0, offset - 164), animated: true })}
            style={[styles.arrow, offset <= 1 && styles.disabled]}><Text style={styles.toggleText}>←</Text></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Next bids" disabled={offset >= remaining - 1}
            accessibilityState={{ disabled: offset >= remaining - 1 }} onPress={() => scroll.current?.scrollTo({ x: Math.min(remaining, offset + 164), animated: true })}
            style={[styles.arrow, offset >= remaining - 1 && styles.disabled]}><Text style={styles.toggleText}>→</Text></Pressable>
        </View>
      </View>
      <ScrollView ref={scroll} horizontal showsHorizontalScrollIndicator accessibilityLabel="Current deal player bids"
        onLayout={event => setViewportWidth(event.nativeEvent.layout.width)}
        onContentSizeChange={width => setContentWidth(width)} onScroll={event => setOffset(event.nativeEvent.contentOffset.x)} scrollEventThrottle={16}
        contentContainerStyle={styles.bidList}>
        {players.map(player => <View key={player.id} testID={`bid-${player.id}`} style={[styles.bidCard, player.id === activePlayerId && styles.active]}>
          <Text numberOfLines={1} style={styles.player}>{player.id === viewerId ? 'You' : player.name}</Text>
          <Text style={styles.bid}>Bid {player.bid}</Text>
          <Text style={styles.detail}>Won {player.tricks} · Need {Math.max(0, player.bid - player.tricks)}</Text>
          <Text style={styles.detail}>{player.cardsRemaining} cards left</Text>
          <Text style={styles.turn}>{player.id === activePlayerId ? paused ? 'Next turn' : 'Current turn' : 'Waiting'}</Text>
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
