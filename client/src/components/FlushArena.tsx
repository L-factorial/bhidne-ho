import {ActiveTurnRing} from './ActiveTurnRing';
import {Ionicons} from '@expo/vector-icons';
import {AppText as Text} from './AppText';
import { ui, uiLabel } from '../i18n/copy.ts';
import { useUiLanguage } from '../i18n/useUiLanguage';
import { PlayerAvatar } from './PlayerAvatar';
import { TableSurface } from './TableSurface';
import { PlayerSocialEffect, useTableSocial } from './TableSocial';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import {AccessibilityInfo, Animated, Pressable, StyleSheet, View} from 'react-native';
import { flushDecision } from '../multiplayer/flushDecision';
import Svg, { Circle } from 'react-native-svg';
import { radii, fonts, useTheme, useThemedStyles, type ThemeColors } from '../theme';
import type { RoomSnapshot } from '../screens/LiveGameTable';
import { flushPlayerNet, minimumArenaHeight, newBets, playerPosition, potBeforeFlights, type FlushBet } from '../multiplayer/flushTable';

export function FlushArena({ snapshot, height = 370, centerControl }: { snapshot: RoomSnapshot; height?: number; centerControl?: ReactNode }) {
  const uiLanguage = useUiLanguage();
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
  const roster = (!pregame && pub?.players) || (snapshot.players || []).map(p => ({ player_id: String(p.player_id), status: 'active', visibility: 'blind', turn_bet_count: 0, total_contribution: 0 }));
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
  const players = pregame ? [...seated, ...Array.from({ length: Math.max(0, (snapshot.table?.max_players || snapshot.capacity || seated.length) - seated.length) }, (_, index) => ({ player_id: `empty-${index}`, status: 'empty', visibility: '', turn_bet_count: 0, total_contribution: 0 }))] : seated;
  const minimumHeight = useMemo(() => minimumArenaHeight(players.length, width), [players.length, width, uiLanguage]);
  height = Math.max(height - 8, minimumHeight);
  const current = pending[0];
  const index = current ? players.findIndex(p => p.player_id === current.player_id) : -1;
  return <View style={[s.arena, { height }]} onLayout={e => setWidth(e.nativeEvent.layout.width)} testID="flush-arena">
    <View pointerEvents="none" style={{ position: 'absolute', top: 12, bottom: 12, left: 4, right: 4 }}><TableSurface game="flush" /></View>
    {!centerControl && <View style={[s.pot,{left:width/2-58,top:height/2-36}]}>
      <Text testID="flush-pot" numberOfLines={1} adjustsFontSizeToFit style={{color:colors.text,fontFamily:fonts.medium,fontSize:18}}>{ui('flush.pot')} = {potBeforeFlights(pub?.pot||0,pending)}</Text>
      <Text style={{color:colors.textMuted,fontSize:13}}>{ui('flush.seen_bet')} = {pub?.current_seen_bet||0}</Text>
      <Text style={{color:colors.textMuted,fontSize:13}}>{ui('flush.blind_bet')} = {pub?.current_blind_bet||0}</Text>
    </View>}
    {players.map((p, i) => {
      const pos = playerPosition(i, players.length, width, height), folded = p.status !== 'active';
      if (p.status === 'empty') return <View key={p.player_id} testID="flush-empty-seat" accessibilityLabel={ui("rooms.empty_seat")} style={[s.seat, { left: pos.x - 40, top: pos.y - 26 }]}><View style={{ width: 38, height: 38, borderRadius: 19, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.onTableHeader, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: colors.onTableHeader, fontSize: 24 }}>+</Text></View><Text style={{ color: colors.onTableHeader, fontSize: 10 }}>{ui("flush.empty")}</Text></View>;
      const sessionNet=flushPlayerNet(pub?.round_results||[],p.player_id,p.total_contribution,!!pub?.settlement||pregame);
      const name = snapshot.players?.find(row => String(row.player_id) === p.player_id)?.display_name || ui("common.player_number", { "number": p.player_id });
      const target = !!social?.pokeMode && social.eligible(Number(p.player_id));
      return <Pressable key={p.player_id} ref={node => social?.registerSeat(Number(p.player_id), node)} collapsable={false}
        testID={`flush-seat-${p.player_id}`} accessibilityLiveRegion="polite" accessibilityRole={target ? 'button' : undefined} accessibilityLabel={`${target ? ui("social.poke_player_2", { "player": name }) : name}${p.player_id === decision?.actor ? `, ${ui('common.current_turn')}` : ''}`} disabled={!target}
        onTouchStart={event => { if (target) event.stopPropagation(); }} onPointerDown={event => { if (target) event.stopPropagation(); }} onPress={() => social?.poke(Number(p.player_id))}
        style={[s.seat, { left: pos.x - 40, top: pos.y - 38, opacity: folded ? 0.4 : 1, minHeight: 44 }]}>
        <PlayerSocialEffect playerId={Number(p.player_id)} />
        <View style={[s.icon, p.player_id === decision?.actor && s.current, target && {borderColor:colors.accent}]}>
          <ActiveTurnRing active={p.player_id===decision?.actor} size={48}/>
          {target && <Text style={{position:'absolute',right:-8,top:-8}}>👋</Text>}<PlayerAvatar uri={snapshot.players?.find(row => String(row.player_id) === p.player_id)?.avatar_url} />{!pregame&&!folded&&<View style={[s.count,{padding:2}]}><Ionicons name={p.visibility==='seen'?'eye-outline':'eye-off-outline'} size={16} color={colors.text} accessibilityLabel={ui(p.visibility==='seen'?'flush.seen':'flush.blind')}/></View>}
          {p.player_id === pub?.dealer_id && <Text accessibilityLabel={ui("common.dealer")} style={s.dealer}>D</Text>}</View>
        <Text testID={`flush-turn-name-${p.player_id}`} numberOfLines={1} style={s.name}>{name}</Text>
        {pregame||folded?<Text style={s.caption}>{ui(pregame?'flush.seated':'flush.folded')}</Text>:null}
        {!pregame&&<View style={{flexDirection:'row',gap:6}}>
          <Text testID={`flush-round-bet-${p.player_id}`} accessibilityLabel={`${ui('flush.round_contribution')}: ${p.total_contribution}`} style={{color:colors.text,fontSize:14}}>{p.total_contribution}</Text>
          <Text testID={`flush-session-net-${p.player_id}`} accessibilityLabel={`${ui('flush.session_net')}: ${sessionNet}`} style={{color:sessionNet>0?colors.gain:sessionNet<0?colors.loss:colors.textMuted,fontSize:14}}>{sessionNet>0?'+':''}{sessionNet}</Text>
        </View>}

      </Pressable>;
    })}
    {!!centerControl && <View pointerEvents="box-none" style={{ position: 'absolute', left: 56, right: 56, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}>{centerControl}</View>}
    {current && <CoinFlight key={current.sequence} bet={current} from={playerPosition(Math.max(0, index), players.length, width, height)} to={{ x: width / 2, y: height / 2 }}
      onFinish={() => setPending(items => items.filter(b => b.sequence !== current.sequence))} />}
  </View>;
}
function CoinFlight({ bet, from, to, onFinish }: { bet: FlushBet; from: { x: number; y: number }; to: { x: number; y: number }; onFinish: () => void }) {
  const uiLanguage = useUiLanguage();
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
    <Text style={{ color: colors.onCoin, backgroundColor: colors.coin, borderRadius: radii.medium, paddingHorizontal: 7, fontWeight: 'bold' }}>+{bet.amount}</Text>
  </Animated.View>;
}
const styles = (c: ThemeColors) => StyleSheet.create({
  arena: { height: 370, flexShrink: 0, width: '100%', maxWidth: 1040, alignSelf: 'center' },
  pot: { backgroundColor: c.surface, borderRadius: radii.large, paddingVertical: 8, position: 'absolute', top: 151, width: 116, alignItems: 'center' }, potValue: { color: c.text, fontFamily: fonts.medium, fontSize: 18 },
  seat: { position: 'absolute', width: 80, alignItems: 'center', gap: 3 },
  icon: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: c.tableTrim, backgroundColor: c.surface },
  dealer: { position: 'absolute', left: -5, bottom: 0, color: c.text, backgroundColor: c.surfaceSelected, borderRadius: 9, minWidth: 18, textAlign: 'center', fontSize: 11 },
  turnLabel: { position: 'absolute', top: -13, color: c.turnText, backgroundColor: c.turnSurface, borderRadius: 4, paddingHorizontal: 4, fontSize: 9, fontFamily: fonts.medium },
  current: { borderColor: c.attention, borderWidth: 3, backgroundColor: c.turnSurface }, count: { position: 'absolute', right: -3, top: -5, color: c.text, backgroundColor: c.surfaceSelected, borderRadius: radii.medium, minWidth: 18, textAlign: 'center', fontSize: 12 },
  name: { backgroundColor: c.surface, borderRadius: radii.medium, paddingHorizontal: 5, color: c.text, fontFamily: fonts.medium, fontSize: 12 }, caption: { backgroundColor: c.surface, borderRadius: 5, paddingHorizontal: 4, color: c.textMuted, fontFamily: fonts.body, fontSize: 10 },
});
