import {CompactCardFace} from './CompactCardFace';
import {AppText as Text} from './AppText';
import { ui } from '../i18n/copy.ts';
import { useUiLanguage } from '../i18n/useUiLanguage';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import {AccessibilityInfo, Animated, StyleSheet, View, useWindowDimensions} from 'react-native';
import { callBreakSeatGeometry, inwardTrickPosition } from '../multiplayer/callbreakLayout';
import { PlayerSeat } from './PlayerSeat';
import { TableSeatLayout } from './TableSeatLayout';
import { radii, fonts, useTheme, useThemedStyles, type ThemeColors } from '../theme';

export type TablePlayer = { id: string; name: string; bid: number; currentBid?: number | null; tricks: number; bids?: number; bonus?: number; cardsRemaining: number; connected?: boolean | null; avatarUrl?: string };
type Props = {
  height?: number; centerControl?: ReactNode; centerStatus?: ReactNode; compact?: boolean; showScores?: boolean; detailedStats?: boolean;
  players: TablePlayer[]; viewerId: string; activePlayerId: string; width: number;
  plays: { playerId: string; card: string }[];
  winnerPlayerId?: string; collecting?: boolean; collectionKey?: string;
  pendingBidPlayerId?: string; dealerId?: string;
  onPokePlayer?: (playerId: string) => void; onPokeTable?: () => void;
};

export function CardTable({ height, players, viewerId, activePlayerId, width, plays, pendingBidPlayerId, dealerId, winnerPlayerId, collecting = false, collectionKey, onPokePlayer, onPokeTable, centerControl, centerStatus, compact = false, showScores = true, detailedStats = false }: Props) {
  useUiLanguage();
  const { colors } = useTheme();
  const { fontScale } = useWindowDimensions();
  const measurementKey = `${width}:${fontScale}:${compact}`;
  const [seatMeasurement, setSeatMeasurement] = useState({ key: '', height: 0 });
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
    geometry={detailedStats ? (count, availableWidth) => callBreakSeatGeometry(count, availableWidth, fontScale, seatMeasurement.key === measurementKey ? seatMeasurement.height : 0, height) : undefined}
    renderSeat={(player, index) => <PlayerSeat playerId={Number(player.id)} name={player.name} mine={player.id === viewerId} active={player.id === activePlayerId}
      inlineStatus={detailedStats && fontScale <= 1 && (players.length < 4 || index !== 1 && index !== players.length - 1)} connected={player.connected} avatarUrl={player.avatarUrl} compact={compact} dealer={dealerId === player.id}
      status={!showScores ? player.cardsRemaining ? `${player.cardsRemaining} cards` : 'Waiting' : compact ? `${player.bid || '—'} / ${player.tricks}` : `Bid ${player.bid || '—'} · Won ${player.tricks}`}
      statusRows={detailedStats && showScores ? [`${player.currentBid === null ? '—' : player.currentBid ?? player.bid} / ${player.tricks}`, ''] : undefined}
      onLayout={detailedStats ? event => { const height = event.nativeEvent.layout.height + 8; setSeatMeasurement(current => current.key === measurementKey && current.height >= height ? current : { key: measurementKey, height }); } : undefined}
      testID={player.id === viewerId ? 'your-seat' : 'opponent-seat'}
      onPress={onPokePlayer && player.id !== viewerId && player.connected !== false ? () => onPokePlayer(player.id) : undefined} />}>
    {(layout, ordered) => {
      const winnerIndex = ordered.findIndex(player => player.id === winnerPlayerId);
      const winner = layout.positions[winnerIndex];
      return <View testID="current-trick-area" style={detailedStats ? { position: 'absolute', inset: 0 } : { position: 'absolute', left: layout.center.x - 72, width: 144, ...(centerControl ? { top: 0, bottom: 0, justifyContent: 'center' } : { top: layout.center.y - 57, height: 114 }) }}>
        {detailedStats && <View testID="callbreak-center-status" style={{ position: 'absolute', left: layout.center.x - 64, top: layout.center.y - 28, height: 56, width: 128, alignItems: 'center', justifyContent: 'center', gap: 4 }}>{centerControl || centerStatus}</View>}
        {(!detailedStats && centerControl) || <>
          {!detailedStats && !plays.length && <Text style={[styles.empty, { textAlign: 'center', paddingTop: 42, fontSize: 12 }]}>{ui("callbreak.current_trick")}</Text>}
          {plays.map((play, playIndex) => {
            const index = ordered.findIndex(player => player.id === play.playerId);
            const player = ordered[index];
            const columns = ordered.length > 4 ? 3 : 2;
            const position = detailedStats ? inwardTrickPosition(layout, index) : { x: 72 + (playIndex % columns - (columns - 1) / 2) * 46, y: 28 + Math.floor(playIndex / columns) * 58 };
            const { x, y } = position;
            return <View key={play.playerId} testID={`trick-play-${play.playerId}`} accessibilityLabel={ui("common.card_played", {player: player?.id === viewerId ? ui("common.you") : player?.name, card: play.card, lead: playIndex === 0 ? ui("common.led_trick") : ""})}
              style={{ position: 'absolute', left: x - 20, top: y - 28 }}>
              <Animated.View testID={play.playerId === winnerPlayerId ? 'winning-card' : 'trick-card'} style={[styles.playedCard,
                playIndex === 0 && { borderWidth: 3, borderColor: colors.accent },
                play.playerId === winnerPlayerId && { borderWidth: 3, borderColor: playIndex === 0 ? colors.accent : colors.cardSelectedBorder, backgroundColor: colors.cardSelected },
                { opacity: progress.interpolate({ inputRange: [0, .8, 1], outputRange: [1, 1, 0] }), transform: reduceMotion ? [] : [
                  { translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [0, winner ? winner.x - (detailedStats ? x : layout.center.x - 72 + x) : 0] }) },
                  { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [0, winner ? winner.y - (detailedStats ? y : layout.center.y - 57 + y) : 0] }) },
                  { scale: progress.interpolate({ inputRange: [0, 1], outputRange: [1, .35] }) }] }]}>
                <CompactCardFace compact rank={play.card.slice(0,-1)} suit={play.card.slice(-1)}/>
                <Text style={styles.playOrder}>{play.playerId === winnerPlayerId ? ui("callbreak.won") : playIndex === 0 ? ui("callbreak.led") : playIndex + 1}</Text>
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
  playedText: { fontFamily: fonts.card, fontSize: 22, color: colors.cardInk },
  red: { color: colors.cardRed },
  club: { color: colors.cardClub },
  playOrder: { color: colors.textMuted, fontFamily: fonts.body, fontSize: 10, textAlign: 'center', marginTop: 6 },
  empty: { color: colors.textMuted, fontSize: 18 },
});
