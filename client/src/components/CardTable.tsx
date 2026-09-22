import { type ReactNode, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, StyleSheet, Text, View } from 'react-native';
import { PlayerSeat } from './PlayerSeat';
import { TableSeatLayout } from './TableSeatLayout';
import { fonts, useTheme, useThemedStyles, type ThemeColors } from '../theme';

export type TablePlayer = { id: string; name: string; bid: number; tricks: number; cardsRemaining: number; connected?: boolean; avatarUrl?: string };
type Props = {
  centerControl?: ReactNode; compact?: boolean; showScores?: boolean;
  players: TablePlayer[]; viewerId: string; activePlayerId: string; width: number;
  plays: { playerId: string; card: string }[];
  winnerPlayerId?: string; collecting?: boolean; collectionKey?: string;
  pendingBidPlayerId?: string; dealerId?: string;
  onPokePlayer?: (playerId: string) => void; onPokeTable?: () => void;
};

export function CardTable({ players, viewerId, activePlayerId, width, plays, pendingBidPlayerId, dealerId, winnerPlayerId, collecting = false, collectionKey, onPokePlayer, onPokeTable, centerControl, compact = false, showScores = true }: Props) {
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
  return <View style={{ width }}><TableSeatLayout testID="card-table" players={players} viewerId={viewerId} compact={compact}
    renderSeat={player => <PlayerSeat playerId={Number(player.id)} name={player.name} mine={player.id === viewerId} active={player.id === activePlayerId}
      connected={player.connected} avatarUrl={player.avatarUrl} compact={compact} dealer={dealerId === player.id}
      status={!showScores ? player.cardsRemaining ? `${player.cardsRemaining} cards` : 'Waiting' : compact ? `${player.bid || '—'} / ${player.tricks}` : `Bid ${player.bid || '—'} · Won ${player.tricks}`}
      testID={player.id === viewerId ? 'your-seat' : 'opponent-seat'}
      onPress={onPokePlayer && player.id !== viewerId && player.connected !== false ? () => onPokePlayer(player.id) : undefined} />}>
    {(layout, ordered) => {
      const winnerIndex = ordered.findIndex(player => player.id === winnerPlayerId);
      const winner = layout.positions[winnerIndex];
      return <View testID="current-trick-area" style={{ position: 'absolute', left: layout.center.x - 72, top: layout.center.y - 57, width: 144, height: 114 }}>
        {centerControl || <>
          {!plays.length && <Text style={[styles.empty, { textAlign: 'center', paddingTop: 42, fontSize: 12 }]}>Current trick</Text>}
          {plays.map((play, playIndex) => {
            const index = ordered.findIndex(player => player.id === play.playerId);
            const player = ordered[index];
            const columns = ordered.length > 4 ? 3 : 2;
            const x = 72 + (playIndex % columns - (columns - 1) / 2) * 46, y = 28 + Math.floor(playIndex / columns) * 58;
            return <View key={play.playerId} accessibilityLabel={`${player?.id === viewerId ? 'You' : player?.name} played ${play.card}${playIndex === 0 ? ', led this trick' : ''}`}
              style={{ position: 'absolute', left: x - 20, top: y - 28 }}>
              <Animated.View testID={play.playerId === winnerPlayerId ? 'winning-card' : 'trick-card'} style={[styles.playedCard,
                play.playerId === winnerPlayerId && { borderWidth: 3, borderColor: colors.cardSelectedBorder, backgroundColor: colors.cardSelected },
                { opacity: progress.interpolate({ inputRange: [0, .8, 1], outputRange: [1, 1, 0] }), transform: reduceMotion ? [] : [
                  { translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [0, winner ? winner.x - (layout.center.x - 72 + x) : 0] }) },
                  { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [0, winner ? winner.y - (layout.center.y - 57 + y) : 0] }) },
                  { scale: progress.interpolate({ inputRange: [0, 1], outputRange: [1, .35] }) }] }]}>
                <Text style={[styles.playedText, /[♥♦]/.test(play.card) && styles.red, play.card.endsWith('♣') && styles.club]}>{play.card}</Text>
                <Text style={styles.playOrder}>{play.playerId === winnerPlayerId ? 'Won' : playIndex === 0 ? 'Led' : playIndex + 1}</Text>
              </Animated.View>
            </View>;
          })}
        </>}
      </View>;
    }}
  </TableSeatLayout></View>;
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  playedCard: { width: 40, height: 56, borderRadius: 8, backgroundColor: colors.cardFace,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.cardBorder },
  playedText: { fontFamily: fonts.display, fontSize: 20, color: colors.cardInk },
  red: { color: colors.cardRed },
  club: { color: colors.cardClub },
  playOrder: { color: colors.textMuted, fontFamily: fonts.body, fontSize: 10, textAlign: 'center', marginTop: 6 },
  empty: { color: '#E3EEDD', fontSize: 18 },
});
