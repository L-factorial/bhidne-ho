import { PlayerAvatar } from './PlayerAvatar';
import { TableSurface } from './TableSurface';
import { PlayerSocialEffect, useTableSocial } from './TableSocial';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { flushDecision } from '../multiplayer/flushDecision';
import Svg, { Circle } from 'react-native-svg';
import { fonts, useTheme, useThemedStyles, type ThemeColors } from '../theme';
import type { RoomSnapshot } from '../screens/LiveGameTable';
import { minimumArenaHeight, newBets, playerPosition, potBeforeFlights, type FlushBet } from '../multiplayer/flushTable';

export function FlushArena({ snapshot, height = 370, centerControl }: { snapshot: RoomSnapshot; height?: number; centerControl?: ReactNode }) {
  const social = useTableSocial();
  const s = useThemedStyles(styles);
  const { colors } = useTheme();
  const [width, setWidth] = useState(300);
  const [pending, setPending] = useState<FlushBet[]>([]);
  const [reduceMotion, setReduceMotion] = useState(false);
  const bets = snapshot.flush?.bets || [];
  const last = useRef<number | null>(null);
  const pub = snapshot.flush?.public;
  const decision = flushDecision(snapshot.flush, snapshot.status === 'playing');
  const pregame = snapshot.table?.phase === 'OPEN' || snapshot.table?.phase === 'LOCKED' || snapshot.status === 'waiting';
  const roster = (!pregame && pub?.players) || (snapshot.players || []).map(p => ({ player_id: String(p.player_id), status: 'active', visibility: 'blind', turn_bet_count: 0 }));
  useEffect(() => { let active = true; AccessibilityInfo.isReduceMotionEnabled().then(v => { if (active) setReduceMotion(v); });
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion); return () => { active = false; sub.remove(); }; }, []);
  const newest = bets.at(-1)?.sequence || 0;
  useEffect(() => {
    if (last.current !== null && !reduceMotion) setPending(current => [...current, ...newBets(bets, last.current!)]);
    last.current = newest;
  }, [newest, reduceMotion]);
  useEffect(() => { if (reduceMotion) setPending([]); }, [reduceMotion]);
  const own = roster.findIndex(p => p.player_id === String(snapshot.your_player_id));
  const seated = own < 0 ? roster : [...roster.slice(own), ...roster.slice(0, own)];
  const players = pregame ? [...seated, ...Array.from({ length: Math.max(0, (snapshot.table?.max_players || snapshot.capacity || seated.length) - seated.length) }, (_, index) => ({ player_id: `empty-${index}`, status: 'empty', visibility: '', turn_bet_count: 0 }))] : seated;
  const minimumHeight = useMemo(() => minimumArenaHeight(players.length, width), [players.length, width]);
  height = Math.max(pregame ? Math.min(height, 520) : Math.min(height, 420), minimumHeight);
  const current = pending[0];
  const index = current ? players.findIndex(p => p.player_id === current.player_id) : -1;
  return <View style={[s.arena, { height }]} onLayout={e => setWidth(e.nativeEvent.layout.width)} testID="flush-arena">
    <View pointerEvents="none" style={{ position: 'absolute', top: 12, bottom: 12, left: 4, right: 4 }}><TableSurface game="flush" /></View>
    {!centerControl && <View style={[s.pot, { left: width / 2 - 58, top: height / 2 - 60 }]}><Text style={s.caption}>TOTAL POT</Text><Text testID="flush-pot" accessibilityLiveRegion="polite" style={s.potValue}>{potBeforeFlights(pub?.pot || 0, pending)}</Text><Text style={s.caption}>points</Text>
      {pub && <><Text style={s.caption}>Round {pub.round_number}</Text><Text style={s.caption}>Blind {pub.current_blind_bet} · Seen {pub.current_seen_bet}</Text></>}
    </View>}
    {players.map((p, i) => {
      const pos = playerPosition(i, players.length, width, height), folded = p.status !== 'active';
      if (p.status === 'empty') return <View key={p.player_id} testID="flush-empty-seat" accessibilityLabel="Empty seat" style={[s.seat, { left: pos.x - 40, top: pos.y - 26 }]}><View style={{ width: 38, height: 38, borderRadius: 19, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.onTableHeader, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: colors.onTableHeader, fontSize: 24 }}>+</Text></View><Text style={{ color: colors.onTableHeader, fontSize: 10 }}>Empty</Text></View>;
      const lastBet = bets.filter(b => b.player_id === p.player_id && b.kind === 'BET_PLACED').at(-1);
      const name = snapshot.players?.find(row => String(row.player_id) === p.player_id)?.display_name || `Player ${p.player_id}`;
      const target = !!social?.pokeMode && social.eligible(Number(p.player_id));
      return <View key={p.player_id} testID={`flush-seat-${p.player_id}`} style={[s.seat, { left: pos.x - 40, top: pos.y - 38, opacity: folded ? 0.4 : 1 }]}>
        <PlayerSocialEffect playerId={Number(p.player_id)} />
        <Pressable accessibilityRole={target ? 'button' : undefined} accessibilityLabel={target ? `Poke ${name}` : name} disabled={!target}
          onTouchStart={event => { if (target) event.stopPropagation(); }} onPointerDown={event => { if (target) event.stopPropagation(); }} onPress={() => social?.poke(Number(p.player_id))}
          style={[s.icon, p.player_id === decision?.actor && s.current, target && {borderColor:colors.accent}]}>
          {target && <Text style={{position:'absolute',right:-8,top:-8}}>👋</Text>}<PlayerAvatar uri={snapshot.players?.find(row => String(row.player_id) === p.player_id)?.avatar_url} />{!pregame && <Text accessibilityLabel={`${p.turn_bet_count} bets`} style={s.count}>Bets {p.turn_bet_count}</Text>}
          {p.player_id === decision?.actor && <Text testID="flush-active-turn" style={s.turnLabel}>TURN</Text>}
          {p.player_id === pub?.dealer_id && <Text accessibilityLabel="Dealer" style={s.dealer}>D</Text>}</Pressable>
        <Text testID={`flush-turn-name-${p.player_id}`} numberOfLines={1} style={s.name}>{name}</Text>
        <Text style={s.caption}>{p.player_id === String(snapshot.your_player_id) ? 'YOU · ' : ''}{pregame ? 'Seated' : folded ? 'Folded' : `${p.visibility}${lastBet ? ` · Bet ${lastBet.amount}` : ''}`}</Text>
      </View>;
    })}
    {!!centerControl && <View pointerEvents="box-none" style={{ position: 'absolute', left: 56, right: 56, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}>{centerControl}</View>}
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
  arena: { height: 370, flexShrink: 0, width: '100%', maxWidth: 1040, alignSelf: 'center' },
  pot: { backgroundColor: c.surface, borderRadius: 18, paddingVertical: 8, position: 'absolute', top: 151, width: 116, alignItems: 'center' }, potValue: { color: c.text, fontFamily: fonts.medium, fontSize: 32 },
  seat: { position: 'absolute', width: 80, alignItems: 'center', gap: 3 },
  icon: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: c.tableTrim, backgroundColor: c.surface },
  dealer: { position: 'absolute', left: -5, bottom: 0, color: c.text, backgroundColor: c.surfaceSelected, borderRadius: 9, minWidth: 18, textAlign: 'center', fontSize: 11 },
  turnLabel: { position: 'absolute', top: -13, color: c.turnText, backgroundColor: c.turnSurface, borderRadius: 4, paddingHorizontal: 4, fontSize: 9, fontFamily: fonts.medium },
  current: { borderColor: c.attention, borderWidth: 3, backgroundColor: c.turnSurface }, count: { position: 'absolute', right: -3, top: -5, color: c.text, backgroundColor: c.surfaceSelected, borderRadius: 10, minWidth: 18, textAlign: 'center', fontSize: 12 },
  name: { backgroundColor: c.surface, borderRadius: 8, paddingHorizontal: 5, color: c.text, fontFamily: fonts.medium, fontSize: 12 }, caption: { backgroundColor: c.surface, borderRadius: 5, paddingHorizontal: 4, color: c.textMuted, fontFamily: fonts.body, fontSize: 10 },
});
