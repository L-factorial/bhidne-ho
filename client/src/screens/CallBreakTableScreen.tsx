import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CardTable, TablePlayer } from '../components/CardTable';
import { DealStatusPanel } from '../components/DealStatusPanel';
import { colors, fonts } from '../theme';
import { AutoPlayTable } from '../testing/AutoPlayTable';

const sampleHand = ['A♠', 'K♠', 'J♠', '8♠', '3♠', 'K♥', '9♥', '4♥', 'Q♦', '7♦', 'A♣', '10♣', '5♣'];

export function CallBreakTableScreen({ capacity, names, tableName, onBack }: {
  capacity: 4 | 5; names: string[]; tableName: string; onBack: () => void;
}) {
  const insets = useSafeAreaInsets();
  const width = Math.max(240, Math.min(useWindowDimensions().width - Math.max(insets.left, 12) - Math.max(insets.right, 12), 800));
  const [selected, setSelected] = useState<string | null>(null);
  const [played, setPlayed] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const hand = sampleHand.slice(0, capacity === 4 ? 13 : 10).filter(card => card !== played);
  // Only the local hand exists in this fixture; opponents expose card counts, never faces.
  const players: TablePlayer[] = Array.from({ length: capacity }, (_, index) => ({
    id: `seat-${index}`, name: names[index] || `Player ${index + 1}`, bid: index === 0 ? 4 : 3,
    tricks: 0, cardsRemaining: capacity === 4 ? 13 : 10,
  }));
  const viewer = players.find(player => player.name === 'You') || players[0];
  viewer.cardsRemaining = hand.length;
  const nextPlayer = players[(players.indexOf(viewer) + 1) % capacity];
  const plays = played ? [{ playerId: viewer.id, card: played }] : [];

  if (testing) return <AutoPlayTable capacity={capacity} names={names} onExit={() => setTesting(false)} />;

  return <LinearGradient colors={[colors.navyLight, colors.navy]} style={{ flex: 1 }}>
    <ScrollView contentContainerStyle={[styles.page, {
      paddingTop: Math.max(insets.top, 16), paddingBottom: Math.max(insets.bottom, 24),
      paddingLeft: Math.max(insets.left, 12), paddingRight: Math.max(insets.right, 12),
    }]}>
      <View style={[styles.content, { width }]}>
        <View style={styles.header}>
          <Pressable accessibilityRole="button" onPress={onBack} style={styles.linkButton}><Text style={styles.link}>← Back to lobby</Text></Pressable>
          <Text style={styles.label}>{capacity} PLAYERS · TABLE PREVIEW</Text>
        </View>
        <Text accessibilityRole="header" style={styles.title}>{tableName}</Text>
        <Text style={styles.meta}>Call Break · Deal 1 of 5 · Spades trump</Text>
        <Pressable accessibilityRole="button" onPress={() => setTesting(true)} style={styles.linkButton}>
          <Text style={styles.link}>Testing only: open autoplay</Text>
        </Pressable>
        <DealStatusPanel players={players} viewerId={viewer.id} activePlayerId={played ? nextPlayer.id : viewer.id}
          cardsPlayed={plays.length} paused={!!played} />
        <Text accessibilityLiveRegion="polite" style={styles.turn}>{played ? 'Card placed · preview paused' : 'Your turn · choose a card'}</Text>
        <CardTable players={players} viewerId={viewer.id} activePlayerId={played ? nextPlayer.id : viewer.id} width={width} plays={plays} />
        <View style={styles.handHeader}><Text style={styles.handTitle}>Your hand</Text><Text style={styles.meta}>{hand.length} cards · Only visible to you</Text></View>
        <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={styles.hand} accessibilityLabel="Your face-up cards">
          {hand.map(card => <Pressable key={card} accessibilityRole="button" accessibilityLabel={`Select ${card}`}
            accessibilityState={{ selected: selected === card, disabled: !!played }} disabled={!!played} onPress={() => setSelected(card)}
            style={[styles.card, selected === card && styles.selectedCard]}>
            <Text style={[styles.rank, /[♥♦]/.test(card) && styles.red]}>{card.slice(0, -1)}</Text>
            <Text style={[styles.suit, /[♥♦]/.test(card) && styles.red]}>{card.slice(-1)}</Text>
          </Pressable>)}
        </ScrollView>
        <Text style={styles.hint}>Swipe your hand to see every card.</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={played ? 'Reset table preview' : 'Place selected card'}
          accessibilityState={{ disabled: !played && !selected }} disabled={!played && !selected}
          onPress={() => { if (played) { setPlayed(null); setSelected(null); } else { setPlayed(selected); setSelected(null); } }}
          style={[styles.action, !played && !selected && { opacity: 0.5 }]}>
          <Text style={styles.actionText}>{played ? 'Reset table preview' : selected ? `Place ${selected} on the table` : 'Select a card to place'}</Text>
        </Pressable>
        <Text style={styles.notice}>Layout preview with sample cards and seats. Card placement is local; turns and game rules aren’t connected yet.</Text>
      </View>
    </ScrollView>
  </LinearGradient>;
}

const styles = StyleSheet.create({
  page: { alignItems: 'center', flexGrow: 1 }, content: { alignItems: 'stretch' }, header: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  linkButton: { minHeight: 44, justifyContent: 'center' }, link: { color: colors.champagne, fontFamily: fonts.body, fontSize: 12 }, label: { color: colors.champagne, fontFamily: fonts.medium, fontSize: 9, letterSpacing: 1 },
  title: { color: colors.ivory, fontFamily: fonts.display, fontSize: 36, marginTop: 12 }, meta: { color: '#B4C1CF', fontFamily: fonts.body, fontSize: 11, lineHeight: 19 },
  turn: { alignSelf: 'center', color: colors.champagne, fontFamily: fonts.medium, fontSize: 12, paddingVertical: 10, marginTop: 14 },
  handHeader: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 6 }, handTitle: { color: colors.ivory, fontFamily: fonts.display, fontSize: 26 },
  hand: { gap: 7, paddingVertical: 16, paddingHorizontal: 3 }, card: { backgroundColor: colors.ivory, width: 48, height: 78, borderRadius: 7, borderWidth: 2, borderColor: colors.line, padding: 6 },
  selectedCard: { borderColor: colors.champagne, transform: [{ translateY: -7 }], backgroundColor: '#FFE6C6' }, rank: { color: colors.ink, fontFamily: fonts.display, fontSize: 23 }, suit: { color: colors.ink, fontSize: 23, textAlign: 'right' }, red: { color: '#A33332' },
  hint: { color: '#B4C1CF', fontFamily: fonts.body, fontSize: 10, marginBottom: 16 }, action: { minHeight: 48, borderRadius: 9, backgroundColor: colors.copper, alignItems: 'center', justifyContent: 'center', padding: 12 },
  actionText: { color: colors.ivory, fontFamily: fonts.medium, fontSize: 13 }, notice: { color: '#B4C1CF', fontFamily: fonts.body, fontSize: 11, lineHeight: 18, textAlign: 'center', marginTop: 20 },
});
