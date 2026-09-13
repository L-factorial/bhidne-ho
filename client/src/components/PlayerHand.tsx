import { CardBack } from './CardBack';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { fonts, useTheme, useThemedStyles, type ThemeColors } from '../theme';

const defaultSuits = ['S', 'C', 'H', 'D'];
function shuffledSuits(previous = defaultSuits, present = defaultSuits) {
  const order = [...previous];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const visible = previous.filter(suit => present.includes(suit));
  if (visible.length > 1 && order.filter(suit => present.includes(suit)).join() === visible.join()) {
    const a = order.indexOf(visible[0]), b = order.indexOf(visible[1]);
    [order[a], order[b]] = [order[b], order[a]];
  }
  return order;
}
const suits: Record<string, string> = { S: '♠', C: '♣', H: '♥', D: '♦' };
const suitNames: Record<string, string> = { S: 'Spades', C: 'Clubs', H: 'Hearts', D: 'Diamonds' };
export type HandView = 'fan' | 'suits' | 'grid';
const ranks = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const suitOf = (card: string) => card.slice(-1);

export function PlayerHand({ hand, legalCards, canPlay, onPlay, view = 'fan', onViewChange, onRevealComplete, turnKey = '', dealKey = '' }: {
  turnKey?: string;
  onRevealComplete?: (dealKey: string | null) => void;
  view?: HandView; onViewChange?: (view: HandView) => void; dealKey?: string;
  hand: string[]; legalCards: string[]; canPlay: boolean; onPlay: (card: string) => void;
}) {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const [suitLayout, setSuitLayout] = useState(() => ({ dealKey, order: shuffledSuits() }));
  useEffect(() => {
    setSuitLayout(current => current.dealKey === dealKey ? current : { dealKey, order: shuffledSuits(current.order) });
  }, [dealKey]);
  const suitOrder = suitLayout.order;
  function shuffleGroups() {
    setSuitLayout(current => ({ dealKey, order: shuffledSuits(current.order, hand.map(suitOf)) }));
  }
  const [selection, setSelection] = useState({ dealKey, suit: 'all' });
  const [revealed, setRevealed] = useState<{ dealKey: string; cards: string[] }>({ dealKey, cards: [] });
  const isRevealed = (card: string) => revealed.dealKey === dealKey && revealed.cards.includes(card);
  const revealing = hand.some(card => !isRevealed(card));
  const fullyRevealed = hand.length > 0 && !revealing;
  const [chosen, setChosen] = useState<{ key: string; card: string } | null>(null);
  const choiceKey = `${dealKey}:${turnKey}`;
  const [hiddenDeal, setHiddenDeal] = useState<string | null>(null);
  useEffect(() => { setHiddenDeal(null); }, [dealKey]);
  const hidden = fullyRevealed && hiddenDeal === dealKey;
  useEffect(() => { onRevealComplete?.(fullyRevealed ? dealKey : null); }, [fullyRevealed, dealKey, onRevealComplete]);
  function revealNext() {
    setRevealed(current => {
      const shown = current.dealKey === dealKey ? current.cards : [];
      const next = hand.find(card => !shown.includes(card));
      return { dealKey, cards: next ? [...shown, next] : shown };
    });
  }
  function revealAll() { setRevealed({ dealKey, cards: [...hand] }); }
  const selectedSuit = selection.dealKey === dealKey ? selection.suit : 'all';
  const sortedCards = [...hand].sort((a, b) => suitOrder.indexOf(suitOf(a)) - suitOrder.indexOf(suitOf(b))
    || ranks.indexOf(a.slice(0, -1)) - ranks.indexOf(b.slice(0, -1)));
  const cards = revealing ? hand : view === 'suits' && selectedSuit !== 'all' ? sortedCards.filter(card => suitOf(card) === selectedSuit) : sortedCards;
  const selectedCard = chosen?.key === choiceKey && canPlay && !hidden && !revealing && cards.includes(chosen.card) && legalCards.includes(chosen.card) ? chosen.card : null;
  useEffect(() => { setChosen(null); }, [choiceKey, canPlay, hidden, view, selectedSuit]);
  function selectCard(card: string) { setChosen({ key: choiceKey, card }); }
  function confirmCard() {
    if (!selectedCard) return;
    setChosen(null);
    onPlay(selectedCard);
  }
  const groups = revealing ? 1 : new Set(cards.map(suitOf)).size;
  const spread = Math.max(0, cards.length - 1) * 10 + Math.max(0, groups - 1) * 3;
  const halfAngle = spread * Math.PI / 360;
  const fanWidth = Math.ceil(2 * (170 * Math.sin(halfAngle) + 32 + 18) + 32);
  let groupAngle = 0;

  if (hidden) {
    const spread = Math.max(0, hand.length - 1) * 10;
    const width = Math.ceil(2 * (170 * Math.sin(spread * Math.PI / 360) + 50) + 32);
    return <View testID="player-hand">
      <ScrollView horizontal contentContainerStyle={styles.scroll} accessibilityLabel="Your hand is face down">
        <View style={{ width, height: 250 }}>
          {hand.map((card, index) => <View key={card} accessible={false} style={[styles.card, styles.cardBack, {
            left: width / 2 - 32 + (hand.length > 1 ? index / (hand.length - 1) * 2 - 1 : 0) * 18,
            top: 18, transformOrigin: 'bottom center', transform: [{ rotate: `${index * 10 - spread / 2}deg` }],
          }]}><CardBack /></View>)}
        </View>
      </ScrollView>
      <View style={styles.selector}>
        <Pressable accessibilityRole="button" accessibilityLabel="Show cards" onPress={() => setHiddenDeal(null)} style={styles.option}><Text style={styles.optionText}>Show cards</Text></Pressable>
      </View>
    </View>;
  }

  return <View testID="player-hand">
    {revealing && <Text style={styles.empty}>Tap the arc to reveal the next card. {hand.filter(isRevealed).length}/{hand.length} revealed.</Text>}
    {!revealing && view === 'grid' ? <ScrollView style={{ height: 250 }} contentContainerStyle={styles.grid} accessibilityLabel="Card grid">
      {cards.map((card, index) => {
        const suit = suitOf(card), faceUp = isRevealed(card), enabled = faceUp && canPlay && legalCards.includes(card);
        return <Pressable key={card} accessibilityRole="button" accessibilityLabel={faceUp ? `Select ${card}` : `Reveal card ${index + 1}`}
          accessibilityHint={faceUp ? `${card.slice(0, -1)} of ${suitNames[suit]}` : 'Turn this card face up without playing it'} disabled={faceUp && !enabled} accessibilityState={{ disabled: faceUp && !enabled, selected: selectedCard === card }} aria-pressed={selectedCard === card}
          onPress={() => { if (enabled) selectCard(card); }} style={[styles.gridCard, !faceUp && styles.cardBack, enabled && styles.legal, selectedCard === card && styles.chosenGrid, faceUp && canPlay && !enabled && { opacity: 0.55 }]}>
          {faceUp ? <>
          <Text style={[styles.gridRank, /[HD]/.test(suit) && styles.red, suit === 'C' && styles.club]}>{card.slice(0, -1)}{suits[suit]}</Text>
          <Text style={[styles.suitName, /[HD]/.test(suit) && styles.red, suit === 'C' && styles.club]}>{suitNames[suit]}</Text>
          </> : <CardBack />}
        </Pressable>;
      })}
    </ScrollView> : <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={styles.scroll}
      accessibilityLabel={revealing ? "Your hand in dealt order" : `Your hand, grouped by suit: ${suitOrder.map(suit => suitNames[suit]).join(', ')}`}>
      <View style={{ width: fanWidth, height: 250 }}>
        {cards.map((card, index) => {
          if (!revealing && index > 0 && suitOf(card) !== suitOf(cards[index - 1])) groupAngle += 3;
          const position = cards.length > 1 ? (index / (cards.length - 1)) * 2 - 1 : 0;
          const angle = index * 10 + groupAngle - spread / 2;
          const faceUp = isRevealed(card), legal = legalCards.includes(card), enabled = !revealing && faceUp && canPlay && legal;
          const red = /[HD]$/.test(card), club = suitOf(card) === 'C';
          return <Pressable key={card} accessibilityRole="button" accessibilityLabel={revealing ? `Reveal next card from position ${index + 1}` : `Select ${card}`}
            accessibilityHint={revealing ? (faceUp ? `${card} is revealed. Reveal the next card in dealt order.` : 'Reveal the next card in dealt order without playing it') : undefined}
            accessibilityState={{ disabled: !revealing && !enabled, selected: selectedCard === card }} aria-pressed={selectedCard === card} disabled={!revealing && !enabled} onPress={() => { if (revealing) revealNext(); else if (enabled) selectCard(card); }}
            style={({ pressed }) => [styles.card, !faceUp && styles.cardBack, enabled && styles.legal, selectedCard === card && styles.chosen, {
              // Keep the bottom pivots within 36px: the entire base stays under two card widths.
              left: fanWidth / 2 - 32 + position * 18,
              top: 18 - (selectedCard === card ? 15 : enabled ? 7 : 0) - (pressed ? 5 : 0),
              transformOrigin: 'bottom center',
              transform: [{ rotate: `${angle}deg` }],
              opacity: !revealing && faceUp && canPlay && !legal ? 0.55 : 1,
            }]}>
            {faceUp ? <View style={styles.corner}>
              <Text style={[styles.rank, red && styles.red, club && styles.club]}>{card.slice(0, -1)}</Text>
              <Text style={[styles.smallSuit, red && styles.red, club && styles.club]}>{suits[suitOf(card)]}</Text>
            </View> : <CardBack />}
          </Pressable>;
        })}
      </View>
    </ScrollView>}
    {selectedCard && <View style={styles.selector}>
      <Pressable accessibilityRole="button" accessibilityLabel={`Play ${selectedCard}`} onPress={confirmCard} style={[styles.option, styles.confirm]}>
        <Text style={styles.optionText}>Play {selectedCard.slice(0, -1)}{suits[suitOf(selectedCard)]}</Text>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Cancel card selection" onPress={() => setChosen(null)} style={styles.option}><Text style={styles.optionText}>Cancel</Text></Pressable>
    </View>}
    {!cards.length && <Text style={styles.empty}>{hand.length ? `No ${suitNames[selectedSuit]?.toLowerCase() || 'cards'} left. Choose another suit.` : 'No cards in your hand.'}</Text>}
    {revealing && <View style={styles.selector}>
      <Pressable accessibilityRole="button" accessibilityLabel="Reveal next card" onPress={revealNext} style={styles.option}><Text style={styles.optionText}>Reveal next</Text></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Flip all cards" onPress={revealAll} style={styles.option}><Text style={styles.optionText}>Flip all</Text></Pressable>
    </View>}
    {!revealing && view === 'suits' && <View accessibilityRole="radiogroup" accessibilityLabel="Filter hand by suit" style={styles.selector}>
      {['all', ...suitOrder].map(suit => {
        const count = suit === 'all' ? hand.length : hand.filter(card => suitOf(card) === suit).length;
        return <Pressable key={suit} accessibilityRole="radio" accessibilityLabel={`${suit === 'all' ? 'All suits' : suitNames[suit]}, ${count} cards`}
          accessibilityState={{ checked: selectedSuit === suit, disabled: count === 0 }} aria-checked={selectedSuit === suit} disabled={count === 0}
          onPress={() => setSelection({ dealKey, suit })} style={[styles.option, selectedSuit === suit && styles.selected, count === 0 && { opacity: 0.4 }]}>
          <Text style={[styles.optionText, suit === 'C' && { color: colors.success }]}>{suit === 'all' ? 'All' : suits[suit]} {count}</Text>
        </Pressable>;
      })}
    </View>}
    {!revealing && hand.length > 0 && <View style={styles.selector}>
      <Pressable accessibilityRole="button" accessibilityLabel="Hide cards" onPress={() => setHiddenDeal(dealKey)} style={styles.option}><Text style={styles.optionText}>Hide cards</Text></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Shuffle suits" onPress={shuffleGroups} style={styles.option}>
        <Text style={styles.optionText}>Shuffle suits</Text>
      </Pressable>
    </View>}
    {!revealing && onViewChange && <View accessibilityRole="radiogroup" accessibilityLabel="Hand view" style={styles.selector}>
      {(['fan', 'suits', 'grid'] as const).map(mode => <Pressable key={mode} accessibilityRole="radio"
        accessibilityLabel={`${mode === 'fan' ? 'Sorted fan' : mode === 'suits' ? 'Suit fan' : 'Card grid'} view`}
        accessibilityState={{ checked: view === mode }} aria-checked={view === mode} onPress={() => onViewChange(mode)}
        style={[styles.option, view === mode && styles.selected]}>
        <Text style={styles.optionText}>{mode === 'fan' ? 'Sorted fan' : mode === 'suits' ? 'Suit fan' : 'Grid'}</Text>
      </Pressable>)}
    </View>}
  </View>;
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  chosen: { borderColor: colors.cardSelectedBorder, borderWidth: 3, backgroundColor: colors.cardSelected },
  chosenGrid: { borderColor: colors.cardSelectedBorder, borderWidth: 3, backgroundColor: colors.cardSelected, transform: [{ translateY: -4 }] },
  confirm: { backgroundColor: colors.surfaceSelected, borderColor: colors.accent },
  cardBack: { backgroundColor: colors.cardBack, borderColor: colors.cardBorder },
  backMark: { color: colors.accent, fontSize: 25, fontWeight: 'bold' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingVertical: 8, justifyContent: 'center' },
  gridCard: { width: 56, minHeight: 60, borderRadius: 8, borderWidth: 2, borderColor: colors.cardBorder, backgroundColor: colors.cardFace, alignItems: 'center', justifyContent: 'center', padding: 4 },
  gridRank: { fontFamily: fonts.medium, fontSize: 21, color: colors.cardInk }, suitName: { fontFamily: fonts.body, fontSize: 9, color: colors.cardInk },
  selector: { flexDirection: 'row', gap: 4, marginTop: 6 }, option: { flex: 1, minWidth: 0, minHeight: 44, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 8 },
  selected: { backgroundColor: colors.surfaceSelected, borderColor: colors.accent }, optionText: { fontFamily: fonts.medium, color: colors.text, fontSize: 12 },
  empty: { color: colors.text, fontFamily: fonts.body, fontSize: 12, padding: 8 },
  scroll: { flexGrow: 1, justifyContent: 'center' },
  card: { position: 'absolute', width: 64, height: 170, borderRadius: 8, backgroundColor: colors.cardFace,
    borderWidth: 2, borderColor: colors.cardBorder, boxShadow: '0px 3px 6px rgba(0, 0, 0, 0.25)' },
  legal: { borderColor: colors.accent },
  corner: { position: 'absolute', top: 3, left: 5, alignItems: 'center' },
  rank: { fontFamily: fonts.medium, fontSize: 17, lineHeight: 21, color: colors.cardInk },
  smallSuit: { fontSize: 23, lineHeight: 27, fontWeight: 'bold', color: colors.cardInk },
  club: { color: colors.cardClub },
  red: { color: colors.cardRed },
});
