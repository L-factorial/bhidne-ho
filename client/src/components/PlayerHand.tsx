import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors, fonts } from '../theme';

const suitOrder = ['S', 'C', 'H', 'D'];
const suits: Record<string, string> = { S: '♠', C: '♣', H: '♥', D: '♦' };
const ranks = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const suitOf = (card: string) => card.slice(-1);

export function PlayerHand({ hand, legalCards, canPlay, onPlay }: {
  hand: string[]; legalCards: string[]; canPlay: boolean; onPlay: (card: string) => void;
}) {
  const cards = [...hand].sort((a, b) => suitOrder.indexOf(suitOf(a)) - suitOrder.indexOf(suitOf(b))
    || ranks.indexOf(a.slice(0, -1)) - ranks.indexOf(b.slice(0, -1)));
  const groups = new Set(cards.map(suitOf)).size;
  const spread = Math.max(0, cards.length - 1) * 10 + Math.max(0, groups - 1) * 3;
  const halfAngle = spread * Math.PI / 360;
  const fanWidth = Math.ceil(2 * (170 * Math.sin(halfAngle) + 32 + 18) + 32);
  let groupAngle = 0;

  return <View>
    <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={styles.scroll}
      accessibilityLabel="Your hand, grouped by suit: spades, clubs, hearts, diamonds">
      <View style={{ width: fanWidth, height: 226 }}>
        {cards.map((card, index) => {
          if (index > 0 && suitOf(card) !== suitOf(cards[index - 1])) groupAngle += 3;
          const position = cards.length > 1 ? (index / (cards.length - 1)) * 2 - 1 : 0;
          const angle = index * 10 + groupAngle - spread / 2;
          const legal = legalCards.includes(card), enabled = canPlay && legal;
          const red = /[HD]$/.test(card), club = suitOf(card) === 'C';
          return <Pressable key={card} accessibilityRole="button" accessibilityLabel={`Play ${card}`}
            accessibilityState={{ disabled: !enabled }} disabled={!enabled} onPress={() => onPlay(card)}
            style={({ pressed }) => [styles.card, enabled && styles.legal, {
              // Keep the bottom pivots within 36px: the entire base stays under two card widths.
              left: fanWidth / 2 - 32 + position * 18,
              top: 18 - (enabled ? 7 : 0) - (pressed ? 5 : 0),
              transformOrigin: 'bottom center',
              transform: [{ rotate: `${angle}deg` }],
              opacity: canPlay && !legal ? 0.55 : 1,
            }]}>
            <View style={styles.corner}>
              <Text style={[styles.rank, red && styles.red, club && styles.club]}>{card.slice(0, -1)}</Text>
              <Text style={[styles.smallSuit, red && styles.red, club && styles.club]}>{suits[suitOf(card)]}</Text>
            </View>
          </Pressable>;
        })}
      </View>
    </ScrollView>
  </View>;
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 1, justifyContent: 'center' },
  card: { position: 'absolute', width: 64, height: 170, borderRadius: 8, backgroundColor: colors.ivory,
    borderWidth: 2, borderColor: '#D5CEC2', boxShadow: '0px 3px 6px rgba(0, 0, 0, 0.25)' },
  legal: { borderColor: colors.copper },
  corner: { position: 'absolute', top: 3, left: 5, alignItems: 'center' },
  rank: { fontFamily: fonts.medium, fontSize: 17, lineHeight: 21, color: colors.ink },
  smallSuit: { fontSize: 23, lineHeight: 27, fontWeight: 'bold', color: colors.ink },
  club: { color: '#176342' },
  red: { color: '#A33332' },
});
