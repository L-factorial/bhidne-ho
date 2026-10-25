import {FlushPlayerStats} from './FlushPlayerStats';
import {useLiveEffects} from '../multiplayer/LivePresentationContext';
import { flushPlayerName } from '../multiplayer/flush';
import {ArrangementSeat,ArrangementHint,useSeatArrangement} from './SeatArrangement';
import {useTableAvatar} from './TableAvatar';
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
  const liveEffects=useLiveEffects();
  const social = useTableSocial();
  const avatar = useTableAvatar();
  const s = useThemedStyles(styles);
  const { colors } = useTheme();
  const [rowHeight,setRowHeight]=useState(120);
  const [centerHeight,setCenterHeight]=useState(90);
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
  const effectEpoch=useRef(liveEffects.epoch);
  useEffect(() => {
    if (effectEpoch.current===liveEffects.epoch && last.current !== null && !reduceMotion && liveEffects.active && liveEffects.ready) {
      const fresh=newBets(bets,last.current);
      // A catch-up batch updates the pot/history without replaying coin flights.
      setPending(fresh.length===1?fresh:[]);
    } else setPending([]);
    last.current = newest;
    effectEpoch.current=liveEffects.epoch;
  }, [newest, reduceMotion, liveEffects.epoch]);
  useEffect(() => { if (reduceMotion) setPending([]); }, [reduceMotion]);
  const arrangement = useSeatArrangement();
  const own = roster.findIndex(p => p.player_id === String(snapshot.your_player_id));
  const seated = own < 0 ? roster : [...roster.slice(own), ...roster.slice(0, own)];
  const originalPlayers = pregame ? [...seated, ...Array.from({ length: Math.max(0, (snapshot.table?.max_players || snapshot.capacity || seated.length) - seated.length) }, (_, index) => ({ player_id: `empty-${index}`, status: 'empty', visibility: '', turn_bet_count: 0, total_contribution: 0 }))] : seated;
  const placement = (id:string) => {const user=snapshot.players?.find(p=>String(p.player_id)===id)?.user_id;return snapshot.table?.seated_players.find(p=>p.user_id===user)?.position_id;};
  const slots = pregame ? snapshot.table?.max_players || snapshot.capacity || originalPlayers.length : originalPlayers.length;
  const ownPosition=placement(String(snapshot.your_player_id))??1;
  const players = pregame && snapshot.table?.seated_players.some(p=>p.position_id) ? Array.from({length:slots},(_,index)=>{const position=(index+ownPosition-1)%slots+1;return originalPlayers.find(p=>p.status!=='empty'&&placement(p.player_id)===position)??{player_id:`empty-${position}`,status:'empty',visibility:'',turn_bet_count:0,total_contribution:0};}) : originalPlayers;
  const positionAt = (index:number) => (index+ownPosition-1)%slots+1;
  const seatInset=Math.max(92,rowHeight-24);
  const measureRow=(height:number)=>setRowHeight(current=>Math.max(current,Math.ceil(height)+8));
  const minimumHeight = useMemo(() => Math.max(minimumArenaHeight(players.length, width, seatInset, rowHeight), 2*seatInset+rowHeight+centerHeight+28), [players.length, width, uiLanguage,seatInset,rowHeight,centerHeight]);
  height = Math.max(height - 8, minimumHeight + (players.length >= 5 ? 160 : 0));
  const displayedPending=liveEffects.active&&liveEffects.ready?pending:[];
  const current = displayedPending[0];
  const index = current ? players.findIndex(p => p.player_id === current.player_id) : -1;
  return <View style={[s.arena, { height }]} onLayout={e => setWidth(e.nativeEvent.layout.width)} testID="flush-arena">
    <View pointerEvents="none" style={{ position: 'absolute', top: 12, bottom: 12, left: 4, right: 4 }}><TableSurface game="flush" /></View>
    {!centerControl && <View onLayout={event=>{const height=event.nativeEvent.layout.height;setCenterHeight(current=>Math.max(current,Math.ceil(height)));}} style={[s.pot,{left:width/2-44,top:height/2+rowHeight/2-38-centerHeight/2}]}>
      <Text testID="flush-pot" numberOfLines={1} adjustsFontSizeToFit style={s.potValue}>{ui('flush.pot')} = {potBeforeFlights(pub?.pot||0,displayedPending)}</Text>
      <Text testID="flush-round" style={s.roundValue}>{ui('flush.round_number',{number:pub?.round_number || 0})}</Text>
      <Text testID="flush-seen-bet" style={s.seenValue}>{ui('flush.seen_bet')} = {pub?.current_seen_bet||0}</Text>
      <Text testID="flush-blind-bet" style={s.blindValue}>{ui('flush.blind_bet')} = {pub?.current_blind_bet||0}</Text>
    </View>}
    {players.map((p, i) => {
      const pos = playerPosition(i, players.length, width, height, seatInset), folded = p.status !== 'active';
      if (p.status === 'empty') return <View key={p.player_id} testID="flush-empty-seat" accessibilityLabel={ui("rooms.empty_seat")} style={[s.seat, { left: pos.x - 40, top: pos.y - 26 }]}><ArrangementSeat onHeight={measureRow} position={positionAt(i)}><View style={{ width: 38, height: 38, borderRadius: 19, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.onTableHeader, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: colors.onTableHeader, fontSize: 24 }}>+</Text></View><Text style={{ color: colors.onTableHeader, fontSize: 10 }}>{ui("flush.empty")}</Text></ArrangementSeat></View>;
      const sessionNet=flushPlayerNet(pub?.round_results||[],p.player_id,p.total_contribution,!!pub?.settlement||pregame);
      const name = flushPlayerName(p.player_id, snapshot.flush?.participants, snapshot.players || []) || ui("common.player_number", { "number": p.player_id });
      const editAvatar = p.player_id === String(snapshot.your_player_id) && !!avatar;
      const target = !!social?.pokeMode && social.eligible(Number(p.player_id));
      return <View key={p.player_id} style={[s.seat,{left:pos.x-40,top:pos.y-38}]}><ArrangementSeat onHeight={measureRow} position={placement(p.player_id)??positionAt(i)} userId={snapshot.players?.find(row=>String(row.player_id)===p.player_id)?.user_id}><Pressable ref={node => social?.registerSeat(Number(p.player_id), node)} collapsable={false}
        testID={`flush-seat-${p.player_id}`} accessibilityLiveRegion="polite" accessibilityRole={target || editAvatar ? 'button' : undefined} accessibilityLabel={`${target ? ui("social.poke_player_2", { "player": name }) : editAvatar ? `${ui("common.choose_avatar")}, ${name}` : name}${p.player_id === decision?.actor ? `, ${ui('common.current_turn')}` : ''}`} disabled={!target && !editAvatar}
        onTouchStart={event => { if (target || editAvatar) event.stopPropagation(); }} onPointerDown={event => { if (target || editAvatar) event.stopPropagation(); }} onPress={() => target ? social?.poke(Number(p.player_id)) : editAvatar && avatar!.open()}
        style={[{width:80,alignItems:"center",gap:3}, { opacity: folded ? 0.4 : 1, minHeight: 44 }]}>
        <PlayerSocialEffect playerId={Number(p.player_id)} />
        <View style={[s.icon, p.player_id === decision?.actor && s.current, target && {borderColor:colors.accent}]}>
          <ActiveTurnRing active={p.player_id===decision?.actor} size={48}/>
          {target && <Text style={{position:'absolute',right:-8,top:-8}}>👋</Text>}<PlayerAvatar uri={editAvatar && avatar?.uri !== undefined ? avatar.uri ?? undefined : snapshot.players?.find(row => String(row.player_id) === p.player_id)?.avatar_url} />
          {p.player_id === pub?.dealer_id && <Text accessibilityLabel={ui("common.dealer")} style={s.dealer}>D</Text>}</View>
        {!pregame&&<View testID={`flush-player-status-${p.player_id}`} style={{flexDirection:'row',alignItems:'center',justifyContent:'center',gap:4,marginTop:3}}>
          {!folded&&<View testID={`flush-visibility-${p.player_id}`} style={s.visibility}><Ionicons name={p.visibility==='seen'?'checkmark-circle':'eye-off-outline'} size={18} color={p.visibility==='seen'?colors.success:colors.textMuted} accessibilityLabel={ui(p.visibility==='seen'?'flush.seen':'flush.blind')}/></View>}
          <FlushPlayerStats id={p.player_id} net={sessionNet} bet={p.total_contribution}/>
        </View>}
        <Text testID={`flush-turn-name-${p.player_id}`} numberOfLines={1} style={s.name}>{name}</Text>
        {pregame||folded?<Text style={s.caption}>{ui(pregame?'flush.seated':'flush.folded')}</Text>:null}


      </Pressable></ArrangementSeat>

      </View>;
    })}
    {!!centerControl && <View pointerEvents="box-none" style={{ position: 'absolute', left: 56, right: 56, top: rowHeight-76, bottom: 0, alignItems: 'center', justifyContent: 'center' }}><View pointerEvents="box-none" onLayout={event=>{const height=event.nativeEvent.layout.height;setCenterHeight(current=>Math.max(current,Math.ceil(height)));}} style={{alignItems:"center",width:"100%"}}>{centerControl}<ArrangementHint /></View></View>}
    {current && <CoinFlight key={current.sequence} bet={current} from={playerPosition(Math.max(0, index), players.length, width, height, seatInset)} to={{ x: width / 2, y: height / 2 }}
      onFinish={() => setPending(items => items.filter(b => b.sequence !== current.sequence))} />}
  </View>;
}
function CoinFlight({ bet, from, to, onFinish }: { bet: FlushBet; from: { x: number; y: number }; to: { x: number; y: number }; onFinish: () => void }) {
  const uiLanguage = useUiLanguage();
  const liveEffects=useLiveEffects();
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
  pot: { backgroundColor: '#1b263e', borderRadius: radii.large, paddingVertical: 8, gap:3, position: 'absolute', top: 151, width: 88, alignItems: 'center' }, potValue: { color:'#f7d66f', fontFamily: fonts.medium, fontWeight:'700', fontSize: 22 },
  roundValue: {color:'#c5baff',fontFamily:fonts.medium,fontSize:13},
  seenValue: {color:'#9ce2bf',fontFamily:fonts.body,fontSize:13},
  blindValue: {color:'#a9d5ff',fontFamily:fonts.body,fontSize:13},
  visibility: {width:22,height:22,borderRadius:11,backgroundColor:c.successSurface,alignItems:'center',justifyContent:'center'},
  seat: { position: 'absolute', width: 80, alignItems: 'center', gap: 3 },
  icon: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: c.tableTrim, backgroundColor: c.surface },
  dealer: { position: 'absolute', left: -5, bottom: 0, color: c.text, backgroundColor: c.surfaceSelected, borderRadius: 9, minWidth: 18, textAlign: 'center', fontSize: 11 },
  turnLabel: { position: 'absolute', top: -13, color: c.turnText, backgroundColor: c.turnSurface, borderRadius: 4, paddingHorizontal: 4, fontSize: 9, fontFamily: fonts.medium },
  current: { borderColor: c.attention, borderWidth: 3, backgroundColor: c.turnSurface }, count: { position: 'absolute', right: -3, top: -5, color: c.text, backgroundColor: c.surfaceSelected, borderRadius: radii.medium, minWidth: 18, textAlign: 'center', fontSize: 12 },
  name: { backgroundColor: c.surface, borderRadius: radii.medium, paddingHorizontal: 5, color: c.text, fontFamily: fonts.medium, fontSize: 12 }, caption: { backgroundColor: c.surface, borderRadius: 5, paddingHorizontal: 4, color: c.textMuted, fontFamily: fonts.body, fontSize: 10 },
});
