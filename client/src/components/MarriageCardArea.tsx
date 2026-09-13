import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { RoomSnapshot } from '../screens/LiveGameTable';
import { marriageFace, type MarriageMove } from '../multiplayer/marriage';
import { MarriagePlayers } from './MarriagePlayers';
import { MarriageCardBack } from './MarriageCardBack';
import { fonts, useThemedStyles, type ThemeColors } from '../theme';

type Point = { x: number; y: number };
function center(node: View): Promise<Point> {
  return new Promise(resolve => node.measureInWindow((x, y, width, height) => resolve({ x: x + width / 2, y: y + height / 2 })));
}

function FlyingCard({ move, origin, destination, done }: { move: MarriageMove; origin: Point; destination: Point; done: () => void }) {
  const styles = useThemedStyles(createStyles);
  const progress = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const animation = Animated.timing(progress, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.cubic), useNativeDriver: true });
    animation.start(({ finished }) => { if (finished) done(); });
    return () => animation.stop();
  }, [progress, done]);
  return <Animated.View pointerEvents="none" testID="marriage-flying-card" accessibilityLabel={move.kind === 'CARD_DRAWN' ? 'Card moving to player' : 'Card moving to discard'}
    style={[styles.card, styles.flying, !move.card && styles.back, {
      opacity: progress.interpolate({ inputRange: [0, 0.85, 1], outputRange: [1, 1, 0] }),
      transform: [
        { translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [origin.x - 26, destination.x - 26] }) },
        { translateY: progress.interpolate({ inputRange: [0, 0.5, 1], outputRange: [origin.y - 36, (origin.y + destination.y) / 2 - 56, destination.y - 36] }) },
        { rotate: progress.interpolate({ inputRange: [0, 0.5, 1], outputRange: ['-8deg', '8deg', '0deg'] }) },
        { scale: progress.interpolate({ inputRange: [0, 0.8, 1], outputRange: [1, 1, 0.75] }) },
      ],
    }]}>{move.card ? <Text style={[styles.face, move.card.suit === 'H' || move.card.suit === 'D' ? styles.red : null]}>{marriageFace(move.card)}</Text> : <MarriageCardBack />}</Animated.View>;
}

export function MarriageCardArea({ snapshot, canAct, hidden, onAction, onPoke }: {
  snapshot: RoomSnapshot; canAct: boolean; hidden: boolean;
  onAction: (command: string, payload?: object) => void; onPoke: (seat: number) => void;
}) {
  const styles = useThemedStyles(createStyles);
  const [maalOpen, setMaalOpen] = useState(false);
  const insets = useSafeAreaInsets();
  const area = useRef<View>(null), stock = useRef<View>(null), discard = useRef<View>(null);
  const seats = useRef(new Map<string, View>());
  const cursor = useRef<number | null>(null);
  const [queue, setQueue] = useState<MarriageMove[]>([]);
  const [flight, setFlight] = useState<{ sequence: number; origin: Point; destination: Point } | null>(null);
  const [reduced, setReduced] = useState(false);
  const marriage = snapshot.marriage!, pub = marriage.public, mine = marriage.private;
  const moves = marriage.moves || [], current = queue[0];
  const finish = useRef(() => { setQueue(q => q.slice(1)); setFlight(null); }).current;
  useEffect(() => {
    let alive = true;
    void AccessibilityInfo.isReduceMotionEnabled().then(value => { if (alive) setReduced(value); });
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => { alive = false; subscription.remove(); };
  }, []);
  useEffect(() => {
    const latest = moves.at(-1)?.sequence || 0;
    if (cursor.current === null) { cursor.current = latest; return; }
    const fresh = moves.filter(m => m.sequence > cursor.current!);
    cursor.current = Math.max(cursor.current, latest);
    if (fresh.length && !reduced) setQueue(q => [...q, ...fresh].slice(-20));
  }, [moves, reduced]);
  useEffect(() => {
    if (!current) return;
    if (reduced) { setQueue([]); setFlight(null); return; }
    const player = seats.current.get(current.player_id), pile = current.kind === 'CARD_DISCARDED' || current.source === 'discard' ? discard.current : stock.current;
    const root = area.current;
    if (!player || !pile || !root) { finish(); return; }
    let cancelled = false;
    // Measure at the time of each move so responsive grids and scrolling align.
    Promise.all([center(player), center(pile), new Promise<Point>(resolve => root.measureInWindow((x, y) => resolve({ x, y })))]).then(([seat, spot, offset]) => {
      if (cancelled) return;
      const from = current.kind === 'CARD_DRAWN' ? spot : seat, to = current.kind === 'CARD_DRAWN' ? seat : spot;
      setFlight({ sequence: current.sequence, origin: { x: from.x - offset.x, y: from.y - offset.y }, destination: { x: to.x - offset.x, y: to.y - offset.y } });
    });
    return () => { cancelled = true; };
  }, [current, reduced, finish]);
  const privateMaal = !hidden ? mine?.maal : null;
  useEffect(() => { if (!privateMaal) setMaalOpen(false); }, [privateMaal]);
  return <View ref={area} style={styles.area}>
    <MarriagePlayers snapshot={snapshot} onPoke={onPoke} registerSeat={(id, node) => { if (node) seats.current.set(id, node); else seats.current.delete(id); }} />
    <View testID="marriage-card-spots" style={styles.spots}>
      <View style={styles.spot}><Text style={styles.label}>Last discard</Text>
        <View ref={discard} testID="marriage-discard-spot" style={styles.card}><Text style={[styles.face, pub.top_discard?.suit === 'H' || pub.top_discard?.suit === 'D' ? styles.red : null]}>
          {current?.kind === 'CARD_DISCARDED' ? '' : pub.top_discard ? marriageFace(pub.top_discard) : '—'}</Text></View>
        <Pressable accessibilityRole="button" accessibilityLabel="Take discard" disabled={!canAct || !mine?.actions.drawable_sources.includes('discard')}
          onPress={() => onAction('DRAW_CARD', { source: 'discard' })} style={[styles.button, (!canAct || !mine?.actions.drawable_sources.includes('discard')) && styles.disabled]}><Text style={styles.buttonText}>Take discard</Text></Pressable>
      </View>
      <View style={styles.spot}><Text style={styles.label}>Deck · {pub.stock_count}</Text>
        <View ref={stock} testID="marriage-stock-spot" style={[styles.card, styles.back, styles.stack]}><MarriageCardBack /></View>
        <Pressable accessibilityRole="button" accessibilityLabel={`Take stock · ${pub.stock_count}`} disabled={!canAct || !mine?.actions.drawable_sources.includes('stock')}
          onPress={() => onAction('DRAW_CARD', { source: 'stock' })} style={[styles.button, (!canAct || !mine?.actions.drawable_sources.includes('stock')) && styles.disabled]}><Text style={styles.buttonText}>Take stock</Text></Pressable>
      </View>
      <View style={styles.spot}><Text style={styles.label}>Maal</Text>
        <Pressable accessibilityRole="button" disabled={!privateMaal} accessibilityState={{ disabled: !privateMaal }} onPress={() => setMaalOpen(true)} accessibilityHint={privateMaal ? 'Show Maal and the marriage sequence' : undefined} testID="marriage-maal-spot" accessibilityLabel={privateMaal ? 'View Maal' : 'Maal hidden'} style={[styles.card, styles.back]}>
          <MarriageCardBack /></Pressable>
        <Text style={styles.caption}>{privateMaal ? 'View Maal' : 'Hidden'}</Text>
      </View>
    </View>
    <Modal transparent visible={maalOpen && !!privateMaal} animationType="none" onRequestClose={() => setMaalOpen(false)}>
      <View style={[styles.backdrop, { paddingTop: Math.max(16, insets.top), paddingBottom: Math.max(16, insets.bottom) }]}>
        <View accessibilityViewIsModal testID="marriage-maal-details" style={styles.dialog}>
          <View style={styles.dialogHeader}><Text accessibilityRole="header" style={styles.heading}>Maal · Marriage sequence</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Close Maal" onPress={() => setMaalOpen(false)} style={styles.button}><Text style={styles.buttonText}>Close ×</Text></Pressable></View>
          {privateMaal && <View style={styles.sequence}>
            {([['Jhiplu', privateMaal.jhiplu], ['Tiplu · Maal', privateMaal.tiplu], ['Paplu', privateMaal.poplu]] as const).map(([label, card]) =>
              <View key={label} style={styles.sequenceCard}><Text style={styles.label}>{label}</Text>
                <View accessibilityLabel={`${label} ${marriageFace(card)}`} style={[styles.card, styles.largeCard]}>
                  <Text style={[styles.face, (card.suit === 'H' || card.suit === 'D') && styles.red]}>{marriageFace(card)}</Text>
                </View>
              </View>)}
          </View>}
        </View>
      </View>
    </Modal>
    {flight && current && flight.sequence === current.sequence && <FlyingCard key={current.sequence} move={current} origin={flight.origin} destination={flight.destination} done={finish} />}
  </View>;
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  backdrop: { flex: 1, paddingHorizontal: 16, backgroundColor: colors.overlay, justifyContent: 'center', alignItems: 'center' },
  dialog: { width: '100%', maxWidth: 440, padding: 16, gap: 20, borderRadius: 16, backgroundColor: colors.surface },
  dialogHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 }, heading: { flex: 1, color: colors.accent, fontFamily: fonts.medium, fontSize: 18 },
  sequence: { flexDirection: 'row', justifyContent: 'center', gap: 12 }, sequenceCard: { alignItems: 'center', gap: 8 }, largeCard: { width: 64, height: 92 },
  area: { flex: 1, minHeight: 0, position: 'relative', gap: 8 }, spots: { flex: 1, flexDirection: 'row', gap: 8, justifyContent: 'center', alignItems: 'center' }, spot: { flex: 1, maxWidth: 150, alignItems: 'center', gap: 4 },
  label: { color: colors.accent, fontFamily: fonts.medium, fontSize: 12 }, card: { width: 52, height: 72, backgroundColor: colors.cardFace, borderRadius: 7, borderWidth: 2, borderColor: colors.cardBorder, alignItems: 'center', justifyContent: 'center' },
  back: { backgroundColor: colors.cardBack, borderColor: colors.cardBorder }, stack: { boxShadow: `3px 3px 0 ${colors.cardBorder}` }, face: { fontFamily: fonts.medium, fontSize: 24, color: colors.cardInk }, red: { color: colors.cardRed },
  button: { minHeight: 44, padding: 7, justifyContent: 'center', backgroundColor: colors.surfaceRaised, borderRadius: 8 }, buttonText: { color: colors.text, fontFamily: fonts.medium, fontSize: 11, textAlign: 'center' },
  disabled: { opacity: 0.42 }, caption: { minHeight: 44, padding: 9, color: colors.textMuted, fontFamily: fonts.body, fontSize: 11 }, flying: { position: 'absolute', left: 0, top: 0, zIndex: 50, elevation: 12 },
});
