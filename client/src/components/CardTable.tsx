import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors, fonts } from '../theme';

export type TablePlayer = { id: string; name: string; bid: number; tricks: number; cardsRemaining: number; connected?: boolean };
type Props = {
  players: TablePlayer[]; viewerId: string; activePlayerId: string; width: number;
  plays: { playerId: string; card: string }[];
  pendingBidPlayerId?: string; dealerId?: string;
  onPokePlayer?: (playerId: string) => void; onPokeTable?: () => void;
};

export function CardTable({ players, viewerId, activePlayerId, width, plays, pendingBidPlayerId, dealerId, onPokePlayer, onPokeTable }: Props) {
  return <ScrollView horizontal style={{ width }} contentContainerStyle={styles.scroll}
    accessibilityLabel="Players in seat order and their played cards">
    <View testID="card-table" style={[styles.row, { width: Math.max(width, players.length * 64) }]}>
      {players.map(player => {
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
            <Text numberOfLines={1} style={styles.name}>{mine ? `You · P${player.id}` : `Player ${player.id}`}</Text>
            <Text style={styles.stats}>{bidPending ? 'Bid —' : `${player.tricks}/${player.bid} tricks`}</Text>
            <Text style={[styles.turn, active && styles.turnActive]}>{player.connected === false ? 'Offline' : active ? (mine ? 'Your turn' : 'Playing') : dealerId === player.id ? 'Dealer' : ' '}</Text>
          </Pressable>
          <Pressable style={styles.playArea} accessibilityRole={onPokeTable ? 'button' : undefined}
            accessibilityLabel={onPokeTable ? 'Poke everyone at the table' : undefined}
            disabled={!onPokeTable} onPress={onPokeTable}>
            {play ? <View accessibilityLabel={`${mine ? 'You' : player.name} played ${play.card}${playIndex === 0 ? ', led this trick' : ''}`}>
              <View style={styles.playedCard}>
                <Text style={[styles.playedText, /[♥♦]/.test(play.card) && styles.red]}>{play.card}</Text>
              </View>
              <Text style={styles.playOrder}>{playIndex === 0 ? 'Led' : `Play ${playIndex + 1}`}</Text>
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
  turn: { color: '#C1CBD5', fontFamily: fonts.body, fontSize: 10 },
  turnActive: { color: colors.champagne },
  playArea: { width: '100%', minHeight: 118, paddingTop: 16, alignItems: 'center', justifyContent: 'center' },
  playedCard: { width: 48, height: 68, borderRadius: 7, backgroundColor: colors.ivory,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.line },
  playedText: { fontFamily: fonts.display, fontSize: 24, color: colors.ink },
  red: { color: '#A33332' },
  playOrder: { color: '#C1CBD5', fontFamily: fonts.body, fontSize: 10, textAlign: 'center', marginTop: 6 },
  empty: { color: '#60768B', fontSize: 18 },
});
