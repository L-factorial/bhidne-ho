import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors, fonts } from '../theme';
import { bidProgress } from '../multiplayer/bidProgress';

export type TablePlayer = { id: string; name: string; bid: number; tricks: number; cardsRemaining: number; connected?: boolean };
type Props = {
  players: TablePlayer[]; viewerId: string; activePlayerId: string; width: number;
  plays: { playerId: string; card: string }[];
  tricksRemaining?: number;
  winnerPlayerId?: string; collecting?: boolean; collectionKey?: string;
  pendingBidPlayerId?: string; dealerId?: string;
  onPokePlayer?: (playerId: string) => void; onPokeTable?: () => void;
};

export function CardTable({ players, viewerId, activePlayerId, width, plays, tricksRemaining, pendingBidPlayerId, dealerId, winnerPlayerId, collecting = false, collectionKey, onPokePlayer, onPokeTable }: Props) {
  const progress = useRef(new Animated.Value(0)).current;
  const [reduceMotion, setReduceMotion] = useState(true);
  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isReduceMotionEnabled().then(value => { if (active) setReduceMotion(value); }).catch(() => {});
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => { active = false; subscription.remove(); };
  }, []);
  useEffect(() => {
    progress.setValue(0);
    if (!collecting || !collectionKey) return;
    const animation = Animated.timing(progress, { toValue: 1, duration: reduceMotion ? 0 : 650, useNativeDriver: true });
    animation.start();
    return () => animation.stop();
  }, [collecting, collectionKey, reduceMotion, progress]);
  const rowWidth = Math.max(width, players.length * 64);
  const pitch = (rowWidth + 6) / players.length;
  const winnerIndex = players.findIndex(player => player.id === winnerPlayerId);
  return <ScrollView horizontal style={{ width }} contentContainerStyle={styles.scroll}
    accessibilityLabel="Players in seat order and their played cards">
    <View testID="card-table" style={[styles.row, { width: Math.max(width, players.length * 64) }]}>
      {players.map((player, index) => {
        const mine = player.id === viewerId, active = player.id === activePlayerId;
        const bidPending = pendingBidPlayerId === player.id || player.bid === 0;
        const bidStatus = bidProgress(bidPending ? 0 : player.bid, player.tricks, tricksRemaining);
        const playIndex = plays.findIndex(play => play.playerId === player.id);
        const play = plays[playIndex];
        return <View key={player.id} style={styles.column}>
          <Pressable testID={mine ? 'your-seat' : 'opponent-seat'}
            accessibilityRole={onPokePlayer && !mine ? 'button' : undefined}
            accessibilityHint={onPokePlayer && !mine ? 'Send this player a private poke' : undefined}
            disabled={!onPokePlayer || mine || player.connected === false} onPress={() => onPokePlayer?.(player.id)}
            accessibilityLabel={`${mine ? 'You' : player.name}${dealerId === player.id ? ', dealer' : ''}, ${bidPending ? 'bid pending' : `bid ${player.bid}, ${player.tricks} tricks won, ${bidStatus.text}`}${active ? ', current turn' : ''}${player.connected === false ? ', disconnected' : ''}`}
            style={[styles.seat, active && styles.active, player.connected === false && styles.disconnected]}>
            <Text numberOfLines={1} style={styles.name}>{mine ? `${player.name} · You` : player.name}</Text>
            <View style={styles.scoreStrip}>
              <Text style={styles.stats}>{bidPending ? 'Bid —' : `Bid ${player.bid}`}</Text>
              <Text style={styles.stats}>Won {player.tricks}</Text>
            </View>
            {!bidPending && <Text testID={`bid-progress-${player.id}`} style={[styles.bidStatus, bidStatus.state === 'met' && styles.met, bidStatus.state === 'missed' && styles.missed]}>{bidStatus.text}</Text>}
            <Text style={[styles.turn, active && styles.turnActive]}>{player.connected === false ? 'Offline' : active ? (mine ? 'Your turn' : 'Playing') : dealerId === player.id ? 'Dealer' : ' '}</Text>
          </Pressable>
          <Pressable style={styles.playArea} accessibilityRole={onPokeTable ? 'button' : undefined}
            accessibilityLabel={onPokeTable ? 'Poke everyone at the table' : undefined}
            disabled={!onPokeTable} onPress={onPokeTable}>
            {play ? <View accessibilityLabel={`${mine ? 'You' : player.name} played ${play.card}${playIndex === 0 ? ', led this trick' : ''}`}>
              <Animated.View testID={player.id === winnerPlayerId ? 'winning-card' : undefined} style={[styles.playedCard, player.id === winnerPlayerId && { borderWidth: 3, borderColor: '#D2943F', backgroundColor: '#FFF0CC' }, { opacity: progress.interpolate({ inputRange: [0, 0.8, 1], outputRange: [1, 1, 0] }), transform: reduceMotion ? [] : [{ translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [0, winnerIndex < 0 ? 0 : (winnerIndex - index) * pitch] }) }, { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [0, -92] }) }, { scale: progress.interpolate({ inputRange: [0, 1], outputRange: [1, 0.35] }) }] }]}>
                <Text style={[styles.playedText, /[♥♦]/.test(play.card) && styles.red, play.card.endsWith('♣') && styles.club]}>{play.card}</Text>
              </Animated.View>
              <Text style={styles.playOrder}>{player.id === winnerPlayerId ? 'Winner' : playIndex === 0 ? 'Led' : `Play ${playIndex + 1}`} </Text>
            </View> : <Text style={styles.empty}>{active ? '•••' : '—'}</Text>}
          </Pressable>
        </View>;
      })}
    </View>
  </ScrollView>;
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 1 },
  row: { flexDirection: 'row', gap: 6, paddingVertical: 8 },
  column: { flex: 1, minWidth: 0, alignItems: 'center' },
  seat: { width: '100%', minHeight: 72, borderWidth: 2, borderColor: 'transparent', borderRadius: 10,
    backgroundColor: '#183750', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 2, paddingVertical: 6, gap: 4 },
  disconnected: { borderColor: '#A78166', borderStyle: 'dashed' },
  active: { borderColor: colors.champagne, backgroundColor: '#29475B' },
  name: { color: colors.ivory, fontFamily: fonts.medium, fontSize: 11 },
  stats: { color: colors.champagne, fontFamily: fonts.body, fontSize: 10 },
  scoreStrip: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', columnGap: 6, rowGap: 2 },
  bidStatus: { color: colors.champagne, fontFamily: fonts.medium, fontSize: 10, textAlign: 'center' },
  met: { color: '#74F4A3' }, missed: { color: '#FFB4A5' },
  turn: { color: '#C1CBD5', fontFamily: fonts.body, fontSize: 10 },
  turnActive: { color: colors.champagne },
  playArea: { width: '100%', minHeight: 118, paddingTop: 16, alignItems: 'center', justifyContent: 'center' },
  playedCard: { width: 48, height: 68, borderRadius: 7, backgroundColor: colors.ivory,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.line },
  playedText: { fontFamily: fonts.display, fontSize: 24, color: colors.ink },
  red: { color: '#A33332' },
  club: { color: '#176342' },
  playOrder: { color: '#C1CBD5', fontFamily: fonts.body, fontSize: 10, textAlign: 'center', marginTop: 6 },
  empty: { color: '#60768B', fontSize: 18 },
});
