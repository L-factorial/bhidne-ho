import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import type { RoomSnapshot } from '../screens/LiveGameTable';
import { marriageFace, type MarriageMove } from '../multiplayer/marriage';
import { MarriagePlayers } from './MarriagePlayers';
import { MarriageCardBack } from './MarriageCardBack';
import { colors, fonts } from '../theme';

type Point = { x: number; y: number };
function center(node: View): Promise<Point> {
  return new Promise(resolve => node.measureInWindow((x, y, width, height) => resolve({ x: x + width / 2, y: y + height / 2 })));
}

function FlyingCard({ move, origin, destination, done }: { move: MarriageMove; origin: Point; destination: Point; done: () => void }) {
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
  const maal = !hidden ? mine?.maal?.tiplu : null;
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
        <View testID="marriage-maal-spot" accessibilityLabel={maal ? `Maal Tiplu ${marriageFace(maal)}` : 'Maal hidden'} style={[styles.card, !maal && styles.back]}>
          {maal ? <Text style={[styles.face, maal.suit === 'H' || maal.suit === 'D' ? styles.red : null]}>{marriageFace(maal)}</Text> : <MarriageCardBack />}</View>
        <Text style={styles.caption}>{maal ? 'Tiplu' : 'Hidden'}</Text>
      </View>
    </View>
    {flight && current && flight.sequence === current.sequence && <FlyingCard key={current.sequence} move={current} origin={flight.origin} destination={flight.destination} done={finish} />}
  </View>;
}

const styles = StyleSheet.create({
  area: { position: 'relative', gap: 20 }, spots: { flexDirection: 'row', gap: 8, justifyContent: 'center' }, spot: { flex: 1, maxWidth: 150, alignItems: 'center', gap: 9 },
  label: { color: colors.champagne, fontFamily: fonts.medium, fontSize: 12 }, card: { width: 52, height: 72, backgroundColor: colors.ivory, borderRadius: 7, borderWidth: 2, borderColor: '#D9C8B0', alignItems: 'center', justifyContent: 'center' },
  back: { backgroundColor: '#688196', borderColor: '#CFB28A' }, stack: { boxShadow: '3px 3px 0 #CFB28A' }, face: { fontSize: 24, fontWeight: 'bold', color: '#162A42' }, red: { color: '#B13639' },
  button: { minHeight: 44, padding: 7, justifyContent: 'center', backgroundColor: '#34516A', borderRadius: 8 }, buttonText: { color: colors.ivory, fontFamily: fonts.medium, fontSize: 11, textAlign: 'center' },
  disabled: { opacity: 0.42 }, caption: { minHeight: 44, padding: 9, color: '#BBC9D6', fontFamily: fonts.body, fontSize: 11 }, flying: { position: 'absolute', left: 0, top: 0, zIndex: 50, elevation: 12 },
});
