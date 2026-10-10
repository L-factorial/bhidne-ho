import {AppText as Text} from './AppText';
import { ui, uiLabel } from '../i18n/copy.ts';
import { useUiLanguage } from '../i18n/useUiLanguage';
import { CardBack } from './CardBack';
import { useCallback, useEffect, useRef, useState } from 'react';
import { MarriageHandCard } from './MarriageHandCard';
import { cardDropTarget, insertHandCardBefore, type CardBounds } from '../multiplayer/marriageHandOrder';
import { groupedCallBreakHand, reconcileCallBreakHand } from '../multiplayer/callbreakHandOrder';
import {Pressable, ScrollView, StyleSheet, View} from 'react-native';
import { visualStates, radii, fonts, gameButtonStyle, useTheme, useThemedStyles, type ThemeColors } from '../theme';

const suits: Record<string, string> = { S: '♠', C: '♣', H: '♥', D: '♦' };
const suitNames: Record<string, string> = { S: 'Spades', C: 'Clubs', H: 'Hearts', D: 'Diamonds' };
export type HandView = 'fan' | 'grid';
const suitOf = (card: string) => card.slice(-1);

export function PlayerHand({ hand, legalCards, canPlay, onPlay, view = 'fan', onViewChange, onRevealComplete, turnKey = '', dealKey = '', compactControls = false, onDragChange }: {
  onDragChange?: (dragging: boolean) => void;
  turnKey?: string; compactControls?: boolean;
  onRevealComplete?: (dealKey: string | null) => void;
  view?: HandView; onViewChange?: (view: HandView) => void; dealKey?: string;
  hand: string[]; legalCards: string[]; canPlay: boolean; onPlay: (card: string) => void;
}) {
  useUiLanguage();
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const suitOrder = ['S', 'H', 'C', 'D'];
  const [manualOrder, setManualOrder] = useState<{ dealKey: string; cards: string[] }>({ dealKey, cards: [] });
  const [dragging, setDragging] = useState(false);
  const cardNodes = useRef(new Map<string, View>());
  const registerCard = useCallback((id: string, node: View | null) => { if (node) cardNodes.current.set(id, node); else cardNodes.current.delete(id); }, []);
  function dragChanged(value: boolean) { setDragging(value); onDragChange?.(value); }
  function groupBySuit() {
    setManualOrder({ dealKey, cards: [] });
  }
  const [revealed, setRevealed] = useState<{ dealKey: string; cards: string[] }>({ dealKey, cards: [] });
  const isRevealed = (card: string) => revealed.dealKey === dealKey && revealed.cards.includes(card);
  const revealing = hand.some(card => !isRevealed(card));
  const fullyRevealed = hand.length > 0 && !revealing;
  const [hovered, setHovered] = useState<string | null>(null);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [chosen, setChosen] = useState<{ key: string; card: string } | null>(null);
  const choiceKey = `${dealKey}:${turnKey}`;
  useEffect(() => { setOptionsOpen(false); setHovered(null); }, [choiceKey]);
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
  const groupedCards = groupedCallBreakHand(hand, suitOrder);
  const orderedCards = reconcileCallBreakHand(groupedCards, manualOrder.dealKey === dealKey ? manualOrder.cards : []);
  const cards = revealing ? hand : orderedCards;
  const dragKey = `${dealKey}:${hand.join(',')}:${view}:${revealing}:${hidden}:${cards.join(',')}`;
  const currentDragKey = useRef(dragKey); currentDragKey.current = dragKey;
  async function dropCard(source: string, x: number, y: number) {
    if (revealing || hidden) return;
    const bounds = await Promise.all([...cardNodes.current].map(([id, node]) => new Promise<CardBounds>(resolve =>
      node.measureInWindow((x, y, width, height) => resolve({ id, x, y, width, height })))));
    if (currentDragKey.current !== dragKey) return;
    const target = cardDropTarget(bounds, source, x, y);
    if (target) {
      setChosen(null);
      setManualOrder(current => ({ dealKey, cards: insertHandCardBefore(reconcileCallBreakHand(groupedCards, current.dealKey === dealKey ? current.cards : []), source, target) }));
    }
  }
  const selectedCard = chosen?.key === choiceKey && canPlay && !hidden && !revealing && cards.includes(chosen.card) && legalCards.includes(chosen.card) ? chosen.card : null;
  useEffect(() => { setChosen(null); }, [choiceKey, canPlay, hidden, view]);
  function selectCard(card: string) { setChosen({ key: choiceKey, card }); }
  function confirmCard() {
    if (!selectedCard) return;
    setChosen(null);
    onPlay(selectedCard);
  }
  const groups = revealing ? 1 : 1 + cards.slice(1).filter((card, index) => suitOf(card) !== suitOf(cards[index])).length;
  const spread = Math.max(0, cards.length - 1) * 10 + Math.max(0, groups - 1) * 3;
  const halfAngle = spread * Math.PI / 360;
  const fanWidth = Math.ceil(2 * (170 * Math.sin(halfAngle) + 32 + 18) + 32);
  let groupAngle = 0;

  if (hidden) {
    const spread = Math.max(0, hand.length - 1) * 10;
    const width = Math.ceil(2 * (170 * Math.sin(spread * Math.PI / 360) + 50) + 32);
    return <View testID="player-hand">
      <ScrollView horizontal contentContainerStyle={styles.scroll} accessibilityLabel={ui("common.your_hand_is_face_down")}>
        <View style={{ width, height: 250 }}>
          {hand.map((card, index) => <View key={card} accessible={false} style={[styles.card, styles.cardBack, {
            left: width / 2 - 32 + (hand.length > 1 ? index / (hand.length - 1) * 2 - 1 : 0) * 18,
            top: 18, transformOrigin: 'bottom center', transform: [{ rotate: `${index * 10 - spread / 2}deg` }],
          }]}><CardBack /></View>)}
        </View>
      </ScrollView>
      <View style={styles.selector}>
        <Pressable accessibilityRole="button" accessibilityLabel={ui("common.show_cards")} onPress={() => setHiddenDeal(null)} style={styles.option}><Text style={styles.optionText}>{ui("common.show_cards")}</Text></Pressable>
      </View>
    </View>;
  }

  return <View testID="player-hand">
    {revealing && <Text style={styles.empty}>{ui("callbreak.reveal_arc", { "shown": hand.filter(isRevealed).length, "total": hand.length })}</Text>}
    {!revealing && view === 'grid' ? <ScrollView scrollEnabled={!dragging} style={{ height: 250 }} contentContainerStyle={styles.grid} accessibilityLabel={ui("common.card_grid")}>
      {cards.map(card => {
        const suit = suitOf(card), faceUp = isRevealed(card), enabled = faceUp && canPlay && legalCards.includes(card);
        return <MarriageHandCard key={card} id={card} testID={`callbreak-hand-card-${card}`} register={registerCard} onDragChange={dragChanged} onDrop={(id, x, y) => void dropCard(id, x, y)}
          wrapperStyle={{ width: 56, height: 80, paddingTop: 0 }} allowDisabledDrag disabled={false} dragDisabled={revealing} pressDisabled={!enabled} selected={selectedCard === card}
          onHoverIn={() => { if (enabled) setHovered(card); }} onHoverOut={() => setHovered(null)}
          label={ui("common.select_card", { card })} hint={ui("common.drag_card_to_reorder")}
          onPress={() => { if (enabled) selectCard(card); }} style={[styles.gridCard, enabled && hovered === card && { transform: [{ translateY: -4 }] }, enabled && styles.legal, selectedCard === card && styles.chosenGrid, faceUp && canPlay && !enabled && { opacity: visualStates.disabledOpacity }]}>
          {faceUp ? <>
          <Text numberOfLines={1} adjustsFontSizeToFit style={[styles.gridRank, /[HD]/.test(suit) && styles.red, suit === 'C' && styles.club]}>{card.slice(0, -1)}{suits[suit]}</Text>
          </> : <CardBack />}
        </MarriageHandCard>;
      })}
    </ScrollView> : <ScrollView scrollEnabled={!dragging} horizontal showsHorizontalScrollIndicator contentContainerStyle={styles.scroll}
      accessibilityLabel={revealing ? ui("common.your_hand_in_dealt_order") : ui("common.your_hand_grouped_by_suit_suits", { "suits": suitOrder.map(suit => uiLabel(suitNames[suit])).join(', ') })}>
      <View style={{ width: fanWidth, height: 250 }}>
        {cards.map((card, index) => {
          if (!revealing && index > 0 && suitOf(card) !== suitOf(cards[index - 1])) groupAngle += 3;
          const position = cards.length > 1 ? (index / (cards.length - 1)) * 2 - 1 : 0;
          const angle = index * 10 + groupAngle - spread / 2;
          const faceUp = isRevealed(card), legal = legalCards.includes(card), enabled = !revealing && faceUp && canPlay && legal;
          const red = /[HD]$/.test(card), club = suitOf(card) === 'C';
          return <MarriageHandCard key={card} id={card} testID={`callbreak-hand-card-${card}`} register={registerCard} onDragChange={dragChanged} onDrop={(id, x, y) => void dropCard(id, x, y)}
            arcAngle={angle} onHoverIn={() => { if (enabled) setHovered(card); }} onHoverOut={() => setHovered(null)}
            allowDisabledDrag disabled={false} dragDisabled={revealing} pressDisabled={!revealing && !enabled} selected={selectedCard === card}
            label={revealing ? ui("common.reveal_next_card_from_position_position", { position: index + 1 }) : ui("common.select_card", { card })}
            hint={revealing ? (faceUp ? ui("common.reveal_card_hint", {card}) : ui("common.reveal_next_hint")) : ui("common.drag_card_to_reorder")}
            onPress={() => { if (revealing) revealNext(); else if (enabled) selectCard(card); }}
            wrapperStyle={{ position: 'absolute', width: 64, height: 170, paddingTop: 0, left: fanWidth / 2 - 32 + position * 18, top: 18 - (selectedCard === card ? 15 : enabled ? 7 : 0) - (enabled && hovered === card ? 5 : 0) }}
            style={[styles.card, !faceUp && styles.cardBack, enabled && styles.legal, selectedCard === card && styles.chosen, {
              left: 0, top: 0, transformOrigin: 'bottom center', transform: [{ rotate: `${angle}deg` }],
              opacity: !revealing && faceUp && canPlay && !legal ? 0.55 : 1,
            }]}>
            {faceUp ? <View style={styles.corner}>
              <Text style={[styles.rank, red && styles.red, club && styles.club]}>{card.slice(0, -1)}</Text>
              <Text style={[styles.smallSuit, red && styles.red, club && styles.club]}>{suits[suitOf(card)]}</Text>
            </View> : <CardBack />}
          </MarriageHandCard>;
        })}
      </View>
    </ScrollView>}
    {selectedCard && <View style={styles.selector}>
      <Pressable accessibilityRole="button" accessibilityLabel={ui("callbreak.play_card", { "card": selectedCard })} onPress={confirmCard} style={({ pressed }) => [styles.option, styles.confirm, pressed && { backgroundColor: colors.primaryPressed }]}>
        <Text style={[styles.optionText, { color: colors.onPrimary }]}>{ui("callbreak.play")}{selectedCard.slice(0, -1)}{suits[suitOf(selectedCard)]}</Text>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={ui("common.cancel_card_selection")} onPress={() => setChosen(null)} style={styles.option}><Text style={styles.optionText}>{ui("common.cancel")}</Text></Pressable>
    </View>}
    {!cards.length && <Text style={styles.empty}>{ui("callbreak.no_cards_in_your_hand")}</Text>}
    {revealing && <View style={styles.selector}>
      <Pressable accessibilityRole="button" accessibilityLabel={ui("common.reveal_next_card")} onPress={revealNext} style={styles.option}><Text style={styles.optionText}>{ui("common.reveal_next")}</Text></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={ui("common.flip_all_cards")} onPress={revealAll} style={styles.option}><Text style={styles.optionText}>{ui("common.flip_all")}</Text></Pressable>
    </View>}
    {!revealing && compactControls && <View style={{ alignItems: 'flex-end' }}>
      <Pressable accessibilityRole="button" accessibilityLabel={ui("common.hand_options")} accessibilityState={{ expanded: optionsOpen }}
        onPress={() => setOptionsOpen(value => !value)} style={({ pressed }) => ({ ...gameButtonStyle(colors, 'secondary', pressed), alignItems: 'center', justifyContent: 'center' })}>
        <Text style={styles.optionText}>•••</Text>
      </Pressable>
    </View>}
    {(!compactControls || optionsOpen) && <>
    {!revealing && hand.length > 0 && <View style={styles.selector}>
      <Pressable accessibilityRole="button" accessibilityLabel={ui("common.hide_cards")} onPress={() => setHiddenDeal(dealKey)} style={styles.option}><Text style={styles.optionText}>{ui("common.hide_cards")}</Text></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={ui("common.shuffle_suits")} onPress={groupBySuit} style={styles.option}>
        <Text style={styles.optionText}>{ui("common.shuffle_suits")}</Text>
      </Pressable>
    </View>}
    {!revealing && onViewChange && <View accessibilityRole="radiogroup" accessibilityLabel={ui("common.hand_view")} style={styles.selector}>
      {(["fan", "grid"] as const).map(mode => <Pressable key={mode} accessibilityRole="radio"
        accessibilityLabel={`${mode === 'fan' ? ui("common.arc") : ui("common.card_grid")} view`}
        accessibilityState={{ checked: view === mode }} aria-checked={view === mode} onPress={() => onViewChange(mode)}
        style={[styles.option, view === mode && styles.selected]}>
        <Text style={styles.optionText}>{mode === 'fan' ? ui("common.arc") : ui("common.grid")}</Text>
      </Pressable>)}
    </View>}
    </>}
  </View>;
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  chosen: { borderColor: colors.cardSelectedBorder, borderWidth: 3, backgroundColor: colors.cardSelected },
  chosenGrid: { borderColor: colors.cardSelectedBorder, borderWidth: 3, backgroundColor: colors.cardSelected, transform: [{ translateY: -4 }] },
  confirm: { ...gameButtonStyle(colors, 'primary') },
  cardBack: { backgroundColor: colors.cardBack, borderColor: colors.cardBorder },
  backMark: { color: colors.accent, fontSize: 25, fontWeight: 'bold' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingVertical: 8, justifyContent: 'center' },
  gridCard: { width: 56, height: 80, borderRadius: radii.medium, borderWidth: 2, borderColor: colors.cardBorder, backgroundColor: colors.cardFace, alignItems: 'center', justifyContent: 'center', padding: 4 },
  gridRank: { fontFamily: fonts.medium, fontSize: 21, color: colors.cardInk },
  selector: { flexDirection: 'row', gap: 4, marginTop: 6 }, option: { flex: 1, alignItems: 'center', justifyContent: 'center', ...gameButtonStyle(colors) },
  selected: { backgroundColor: colors.surfaceSelected, borderColor: colors.accent }, optionText: { fontFamily: fonts.medium, color: colors.onTableHeader, fontSize: 12 },
  empty: { color: colors.text, fontFamily: fonts.body, fontSize: 12, padding: 8 },
  scroll: { flexGrow: 1, justifyContent: 'center' },
  card: { position: 'absolute', width: 64, height: 170, borderRadius: radii.medium, backgroundColor: colors.cardFace,
    borderWidth: 2, borderColor: colors.cardBorder, boxShadow: `0px 3px 6px ${colors.shadow}` },
  legal: { borderColor: colors.attention },
  corner: { position: 'absolute', top: 3, left: 5, alignItems: 'center' },
  rank: { fontFamily: fonts.medium, fontSize: 17, lineHeight: 21, color: colors.cardInk },
  smallSuit: { fontSize: 23, lineHeight: 27, fontWeight: 'bold', color: colors.cardInk },
  club: { color: colors.cardClub },
  red: { color: colors.cardRed },
});
