import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, StyleSheet, Text, View } from 'react-native';
import { TurnPulse } from './TurnPulse';
import Svg, { Circle, Ellipse, G, Path } from 'react-native-svg';
import { fonts, useTheme, useThemedStyles, type ThemeColors } from '../theme';
import type { RoomSnapshot } from '../screens/LiveGameTable';
import { newBets, playerPosition, potBeforeFlights, type FlushBet } from '../multiplayer/flushTable';

function PlayerFace({ seen, folded }: { seen: boolean; folded: boolean }) {
  const { colors } = useTheme();
  const outline = '#835126', skin = '#FFD477', hand = '#FFE4A5';
  return <Svg width={48} height={44} viewBox="0 0 64 60" accessibilityLabel={folded ? 'Folded' : seen ? 'Seen: sparkling eyes, hands on cheeks' : 'Blind: hands covering eyes'}>
    <Circle cx={32} cy={29} r={23} fill={skin} stroke={outline} strokeWidth={1.5} />
    <Path d="M19 14 Q25 9 31 12" stroke="#FFF0B5" strokeWidth={3} strokeLinecap="round" fill="none" />
    {seen ? <>
      {[23, 41].map(x => <G key={x}>
        <Ellipse cx={x} cy={25} rx={5} ry={7} fill="#382A28" />
        <Path d={`M${x} 19 L${x + 1.2} 23 L${x + 4} 24 L${x + 1.2} 25.2 L${x} 29 L${x - 1} 25.2 L${x - 4} 24 L${x - 1} 23 Z`} fill="#FFFFFF" />
        <Circle cx={x + 2} cy={28} r={1} fill="#FFFFFF" />
      </G>)}
      <Ellipse cx={18} cy={35} rx={5} ry={3} fill="#F29C79" opacity={0.65} />
      <Ellipse cx={46} cy={35} rx={5} ry={3} fill="#F29C79" opacity={0.65} />
      <Path d="M26 36 Q32 43 38 36" stroke={outline} strokeWidth={2} strokeLinecap="round" fill="none" />
      {[false, true].map(right => <G key={String(right)} transform={right ? 'translate(64 0) scale(-1 1)' : undefined}>
        <Path d="M8 54 L7 41 Q6 36 10 30 Q12 27 14 30 L17 36 L16 30 Q16 27 19 29 L23 39 Q25 44 21 48 L20 55 Z" fill={hand} stroke={outline} strokeWidth={1.3} strokeLinejoin="round" />
        <Path d="M11 36 L14 42 M15 34 L18 40" fill="none" stroke="#CCA064" strokeWidth={1.2} strokeLinecap="round" />
      </G>)}
      <Path d="M55 4 L56.5 8.5 L61 10 L56.5 11.5 L55 16 L53.5 11.5 L49 10 L53.5 8.5 Z" fill={colors.accent} />
    </> : <>
      <Path d="M27 39 Q32 42 37 39" stroke={outline} strokeWidth={2} strokeLinecap="round" fill="none" />
      {[false, true].map(right => <G key={String(right)} transform={right ? 'translate(64 0) scale(-1 1)' : undefined}>
        <Path d="M8 49 L7 28 Q7 24 10 24 L14 26 L14 17 Q14 13 17 14 L18 22 L19 13 Q20 10 22 13 L23 22 L24 13 Q26 11 27 15 L28 23 L29 18 Q32 16 32 21 L31 32 Q31 38 24 41 L22 51 Z" fill={hand} stroke={outline} strokeWidth={1.3} strokeLinejoin="round" />
        <Path d="M18 22 L19 29 M23 22 L24 29 M28 23 L28 29" fill="none" stroke="#CCA064" strokeWidth={1.2} strokeLinecap="round" />
      </G>)}
    </>}
    {folded && <Path d="M13 10 L51 50 M51 10 L13 50" stroke={colors.danger} strokeWidth={4} strokeLinecap="round" />}
  </Svg>;
}
export function FlushArena({ snapshot, height = 370 }: { snapshot: RoomSnapshot; height?: number }) {
  const s = useThemedStyles(styles);
  const [width, setWidth] = useState(300);
  const [pending, setPending] = useState<FlushBet[]>([]);
  const [reduceMotion, setReduceMotion] = useState(false);
  const bets = snapshot.flush?.bets || [];
  const last = useRef<number | null>(null);
  const pub = snapshot.flush!.public;
  useEffect(() => { let active = true; AccessibilityInfo.isReduceMotionEnabled().then(v => { if (active) setReduceMotion(v); });
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion); return () => { active = false; sub.remove(); }; }, []);
  const newest = bets.at(-1)?.sequence || 0;
  useEffect(() => {
    if (last.current !== null && !reduceMotion) setPending(current => [...current, ...newBets(bets, last.current!)]);
    last.current = newest;
  }, [newest, reduceMotion]);
  useEffect(() => { if (reduceMotion) setPending([]); }, [reduceMotion]);
  const own = pub.players.findIndex(p => p.player_id === String(snapshot.your_player_id));
  const players = own < 0 ? pub.players : [...pub.players.slice(own), ...pub.players.slice(0, own)];
  const current = pending[0];
  const index = current ? players.findIndex(p => p.player_id === current.player_id) : -1;
  return <View style={[s.arena, { height }]} onLayout={e => setWidth(e.nativeEvent.layout.width)} testID="flush-arena">
    <View style={[s.ellipse, { left: 34, width: Math.max(100, width - 68), top: 48, height: height - 96 }]} />
    <View style={[s.pot, { left: width / 2 - 58, top: height / 2 - 29 }]}><Text style={s.caption}>TOTAL POT</Text><Text testID="flush-pot" accessibilityLiveRegion="polite" style={s.potValue}>{potBeforeFlights(pub.pot, pending)}</Text><Text style={s.caption}>chips</Text></View>
    {players.map((p, i) => {
      const pos = playerPosition(i, players.length, width, height), folded = p.status !== 'active';
      const name = snapshot.players?.find(row => String(row.player_id) === p.player_id)?.display_name || `Player ${p.player_id}`;
      return <View key={p.player_id} testID={`flush-seat-${p.player_id}`} style={[s.seat, { left: pos.x - 40, top: pos.y - 38, opacity: folded ? 0.4 : 1 }]}>
        <View style={[s.icon, p.player_id === pub.current_player_id && s.current]}><PlayerFace seen={p.visibility === 'seen'} folded={folded} /><Text style={s.count}>{p.turn_bet_count}</Text></View>
        <TurnPulse active={p.player_id === pub.current_player_id} testID={`flush-turn-name-${p.player_id}`} numberOfLines={1} style={s.name}>{name}{p.player_id === String(snapshot.your_player_id) ? ' · You' : ''}</TurnPulse>
        <Text style={s.caption}>{folded ? 'Folded' : `${p.visibility} · bet ${p.turn_bet_count}`}</Text>
      </View>;
    })}
    {current && <CoinFlight key={current.sequence} bet={current} from={playerPosition(Math.max(0, index), players.length, width, height)} to={{ x: width / 2, y: height / 2 }}
      onFinish={() => setPending(items => items.filter(b => b.sequence !== current.sequence))} />}
  </View>;
}
function CoinFlight({ bet, from, to, onFinish }: { bet: FlushBet; from: { x: number; y: number }; to: { x: number; y: number }; onFinish: () => void }) {
  const { colors } = useTheme();
  const value = useRef(new Animated.Value(0)).current;
  const done = useRef(onFinish); done.current = onFinish;
  useEffect(() => {
    const animation = Animated.timing(value, { toValue: 1, duration: 850, useNativeDriver: true });
    animation.start(({ finished }) => { if (finished) done.current(); }); return () => animation.stop();
  }, [value]);
  return <Animated.View testID="flush-coin-flight" pointerEvents="none" style={{ position: 'absolute', left: from.x - 26, top: from.y - 20, zIndex: 10, alignItems: 'center',
    opacity: value.interpolate({ inputRange: [0, .12, .8, 1], outputRange: [0, 1, 1, 0] }), transform: [
      { translateX: value.interpolate({ inputRange: [0, 1], outputRange: [0, to.x - from.x] }) },
      { translateY: value.interpolate({ inputRange: [0, 1], outputRange: [0, to.y - from.y] }) }] }}>
    <Svg width={44} height={30} viewBox="0 0 44 30">{[0, 1, 2].map(i => <Circle key={i} cx={14 + i * 7} cy={18 - i * 4} r={10} fill={colors.coin} stroke={colors.coinBorder} strokeWidth={2} />)}</Svg>
    <Text style={{ color: colors.onCoin, backgroundColor: colors.coin, borderRadius: 8, paddingHorizontal: 7, fontWeight: 'bold' }}>+{bet.amount}</Text>
  </Animated.View>;
}
const styles = (c: ThemeColors) => StyleSheet.create({
  arena: { height: 370, width: '100%', maxWidth: 680, alignSelf: 'center' },
  ellipse: { position: 'absolute', top: 62, height: 238, borderRadius: 160, backgroundColor: c.surface, borderColor: c.border, borderWidth: 2 },
  pot: { position: 'absolute', top: 151, width: 116, alignItems: 'center' }, potValue: { color: c.text, fontFamily: fonts.medium, fontSize: 32 },
  seat: { position: 'absolute', width: 80, alignItems: 'center', gap: 3 },
  icon: { width: 64, height: 48, borderRadius: 28, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: 'transparent', backgroundColor: c.background },
  current: { borderColor: c.turnText }, count: { position: 'absolute', right: -3, top: -5, color: c.text, backgroundColor: c.surfaceSelected, borderRadius: 10, minWidth: 18, textAlign: 'center', fontSize: 12 },
  name: { color: c.text, fontFamily: fonts.medium, fontSize: 12 }, caption: { color: c.textMuted, fontFamily: fonts.body, fontSize: 10 },
});
