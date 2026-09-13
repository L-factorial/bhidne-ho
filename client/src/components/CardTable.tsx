import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { fonts, useTheme, useThemedStyles, type ThemeColors } from '../theme';

export type TablePlayer = { id: string; name: string; bid: number; tricks: number; cardsRemaining: number; connected?: boolean };
type Props = {
  players: TablePlayer[]; viewerId: string; activePlayerId: string; width: number;
  plays: { playerId: string; card: string }[];
  winnerPlayerId?: string; collecting?: boolean; collectionKey?: string;
  pendingBidPlayerId?: string; dealerId?: string;
  onPokePlayer?: (playerId: string) => void; onPokeTable?: () => void;
};

export function CardTable({ players, viewerId, activePlayerId, width, plays, pendingBidPlayerId, dealerId, winnerPlayerId, collecting = false, collectionKey, onPokePlayer, onPokeTable }: Props) {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
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
        const playIndex = plays.findIndex(play => play.playerId === player.id);
        const play = plays[playIndex];
        return <View key={player.id} style={styles.column}>
          <Pressable testID={mine ? 'your-seat' : 'opponent-seat'}
            accessibilityRole={onPokePlayer && !mine ? 'button' : undefined}
            accessibilityHint={onPokePlayer && !mine ? 'Send this player a private poke' : undefined}
            disabled={!onPokePlayer || mine || player.connected === false} onPress={() => onPokePlayer?.(player.id)}
            accessibilityLabel={`${mine ? 'You' : player.name}${dealerId === player.id ? ', dealer' : ''}, ${bidPending ? 'bid pending' : `bid ${player.bid}, ${player.tricks} tricks won`}${active ? ', current turn' : ''}${player.connected === false ? ', disconnected' : ''}`}
            style={[styles.seat, active && styles.active, player.connected === false && styles.disconnected]}>
            <Text numberOfLines={1} style={styles.name}>{mine ? `${player.name} · You` : player.name}</Text>
            <View style={styles.scoreStrip}>
              <Text style={styles.stats}>{bidPending ? 'Bid —' : `Bid ${player.bid}`}</Text>
              <Text style={styles.stats}>Won {player.tricks}</Text>
            </View>
          </Pressable>
          <Pressable style={styles.playArea} accessibilityRole={onPokeTable ? 'button' : undefined}
            accessibilityLabel={onPokeTable ? 'Poke everyone at the table' : undefined}
            disabled={!onPokeTable} onPress={onPokeTable}>
            {play ? <View accessibilityLabel={`${mine ? 'You' : player.name} played ${play.card}${playIndex === 0 ? ', led this trick' : ''}`}>
              <Animated.View testID={player.id === winnerPlayerId ? 'winning-card' : undefined} style={[styles.playedCard, player.id === winnerPlayerId && { borderWidth: 3, borderColor: colors.cardSelectedBorder, backgroundColor: colors.cardSelected }, { opacity: progress.interpolate({ inputRange: [0, 0.8, 1], outputRange: [1, 1, 0] }), transform: reduceMotion ? [] : [{ translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [0, winnerIndex < 0 ? 0 : (winnerIndex - index) * pitch] }) }, { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [0, -104] }) }, { scale: progress.interpolate({ inputRange: [0, 1], outputRange: [1, 0.35] }) }] }]}>
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

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  scroll: { flexGrow: 1 },
  row: { flexDirection: 'row', gap: 6, paddingVertical: 8 },
  column: { flex: 1, minWidth: 0, alignItems: 'center' },
  seat: { width: '100%', minHeight: 72, borderWidth: 2, borderColor: 'transparent', borderRadius: 10,
    backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 2, paddingVertical: 6, gap: 4 },
  disconnected: { borderColor: colors.border, borderStyle: 'dashed' },
  active: { borderColor: colors.turnText, backgroundColor: colors.turnSurface },
  name: { color: colors.text, fontFamily: fonts.medium, fontSize: 13 },
  stats: { color: colors.accent, fontFamily: fonts.medium, fontSize: 13 },
  scoreStrip: { alignItems: 'center', gap: 3 },
  playArea: { width: '100%', minHeight: 142, paddingTop: 16, alignItems: 'center', justifyContent: 'center' },
  playedCard: { width: 54, height: 80, borderRadius: 8, backgroundColor: colors.cardFace,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.cardBorder },
  playedText: { fontFamily: fonts.display, fontSize: 28, color: colors.cardInk },
  red: { color: colors.cardRed },
  club: { color: colors.cardClub },
  playOrder: { color: colors.textMuted, fontFamily: fonts.body, fontSize: 10, textAlign: 'center', marginTop: 6 },
  empty: { color: colors.textMuted, fontSize: 18 },
});
