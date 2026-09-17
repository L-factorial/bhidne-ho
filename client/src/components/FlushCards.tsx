import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { CardBack } from './CardBack';
import { useTheme } from '../theme';

const symbols: Record<string, string> = { S: '♠', H: '♥', D: '♦', C: '♣' };
export function FlushCards({ cards, hidden = false, label = 'Your card', onComplete, autoReveal = false, autoHideMs = 0, tapToToggle = false }: {
  cards: string[]; tapToToggle?: boolean; autoHideMs?: number; autoReveal?: boolean; hidden?: boolean; label?: string; onComplete?: () => void;
}) {
  const [peekAll, setPeekAll] = useState(false);
  const [previewed, setPreviewed] = useState(false);
  const [previewCards, setPreviewCards] = useState<number[]>([]);
  const [revealed, setRevealed] = useState<number[]>([]);
  const previewTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const { colors } = useTheme();
  useEffect(() => () => previewTimers.current.forEach(clearTimeout), []);
  function preview() {
    if (!tapToToggle || previewed || cards.length !== 3) return;
    previewTimers.current.forEach(clearTimeout); previewTimers.current = [];
    [0, 1, 2].forEach((index, step) => previewTimers.current.push(setTimeout(() => setPreviewCards(current => [...current, index]), step * 150)));
    [2, 1, 0].forEach((index, step) => previewTimers.current.push(setTimeout(() => {
      setPreviewCards(current => current.filter(value => value !== index));
      if (index === 0) setPreviewed(true);
    }, 780 + step * 120)));
  }
  useEffect(() => { if (tapToToggle && cards.length === 3 && !previewed) preview(); }, [tapToToggle, cards.join('|'), previewed]);
  useEffect(() => { if (hidden && autoHideMs > 0) setRevealed([]); }, [hidden, autoHideMs]);
  return <View testID="flush-card-arc" style={{ height: 172, width: 280, alignSelf: 'center' }}>
    {[0, 1, 2].map(index => <FlipCard key={index} card={cards[index]} index={index} label={label}
      revealed={!hidden && (autoReveal || (tapToToggle ? peekAll || previewCards.includes(index) : revealed.includes(index)))} disabled={tapToToggle || autoReveal || hidden || !cards[index] || revealed.includes(index)}
      autoHideMs={autoReveal ? 0 : autoHideMs} onConceal={() => setRevealed(current => current.filter(i => i !== index))}
      onFlip={() => { const next = [...revealed, index]; setRevealed(next); if (next.length === 3) onComplete?.(); }} />)}
    {tapToToggle && cards.length === 3 && <Pressable accessibilityRole="button"
      accessibilityLabel={previewed ? 'Press and hold to see cards' : 'See cards'}
      accessibilityState={{ expanded: peekAll }}
      onPressIn={() => { if (previewed) setPeekAll(true); }} onPressOut={() => { if (previewed) setPeekAll(false); }}
      onPress={preview}
      style={StyleSheet.absoluteFill} />}
    {!cards.length && <Text style={{ color: colors.textMuted, textAlign: 'center', position: 'absolute', bottom: 0, width: '100%' }}>Blind · See cards when eligible</Text>}
  </View>;
}
function FlipCard({ card, index, label, revealed, disabled, onFlip, autoHideMs, onConceal }: {
  autoHideMs: number; onConceal: () => void; card?: string; index: number; label: string; revealed: boolean; disabled: boolean; onFlip: () => void;
}) {
  const { colors } = useTheme();
  const conceal = useRef(onConceal);
  conceal.current = onConceal;
  useEffect(() => {
    if (!revealed || autoHideMs <= 0) return;
    const timer = setTimeout(() => conceal.current(), autoHideMs);
    return () => clearTimeout(timer);
  }, [revealed, autoHideMs]);
  const progress = useRef(new Animated.Value(0)).current;
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled().then(value => { if (alive) setReduced(value); });
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => { alive = false; sub.remove(); };
  }, []);
  useEffect(() => {
    const animation = Animated.timing(progress, { toValue: revealed ? 1 : 0, duration: reduced ? 0 : 160, useNativeDriver: true });
    animation.start(); return () => animation.stop();
  }, [revealed, progress, reduced]);
  return <Pressable accessibilityRole="button" accessibilityLabel={revealed ? `${label} ${index + 1}: ${card}` : `Flip ${label.toLowerCase()} ${index + 1}`}
    disabled={disabled} accessibilityState={{ disabled }} onPress={onFlip}
    style={{ position: 'absolute', width: 80, height: 116, left: 30 + index * 70, top: index === 1 ? 12 : 24, transform: [{ rotate: `${(index - 1) * 13}deg` }] }}>
    <Animated.View style={[StyleSheet.absoluteFill, { borderRadius: 9, overflow: 'hidden', backfaceVisibility: 'hidden',
      transform: [{ perspective: 600 }, { rotateY: progress.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '180deg'] }) }] }]}><CardBack /></Animated.View>
    <Animated.View accessibilityElementsHidden={!revealed} importantForAccessibility={revealed ? 'auto' : 'no-hide-descendants'} style={[StyleSheet.absoluteFill, {
      backgroundColor: colors.cardFace, borderColor: colors.cardBorder, borderWidth: 1, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backfaceVisibility: 'hidden',
      transform: [{ perspective: 600 }, { rotateY: progress.interpolate({ inputRange: [0, 1], outputRange: ['180deg', '360deg'] }) }],
    }]}>{revealed && card && <Text style={{ fontSize: 30, color: /[HD]$/.test(card) ? colors.cardRed : colors.cardInk }}>{card.slice(0, -1)}{symbols[card.slice(-1)]}</Text>}</Animated.View>
  </Pressable>;
}
