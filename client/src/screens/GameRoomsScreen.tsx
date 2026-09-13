import { AppHeader } from '../components/AppHeader';
import { GameIcon } from '../components/BrandArt';
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { fonts, useTheme, useThemedStyles, type ThemeColors } from '../theme';

export type GameId = 'callbreak' | 'flush' | 'marriage';
const gameOptions = (colors: ThemeColors) => [
  { id: 'callbreak', name: 'Call Break', symbol: '♠', cards: 'K ♠   Q ♠   J ♠',
    description: 'Make your call. Take the trick. Find your table.', detail: '4 or 5 players · Five deals', tint: colors.surface },
  { id: 'flush', name: 'Flush', symbol: '♦', cards: 'A ♦   K ♦   Q ♦',
    description: 'A little suspense. A familiar circle of friends.', detail: 'Game room preview', tint: colors.dangerSurface },
  { id: 'marriage', name: 'Marriage', symbol: '♥', cards: 'J ♥   Q ♥   K ♥',
    description: 'Bring your people together for another round.', detail: 'Game room preview', tint: colors.dangerSurface },
] as const;

export function GameRoomsScreen({ selected, onSelect, onBack, onLeave }: {
  selected: Exclude<GameId, 'callbreak'> | null;
  onSelect: (game: GameId) => void; onBack: () => void; onLeave: () => void;
}) {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const wide = useWindowDimensions().width >= 960;
  const insets = useSafeAreaInsets();
  const games = gameOptions(colors);
  const game = games.find(item => item.id === selected);
  return <LinearGradient colors={[colors.surface, colors.background]} style={styles.page}>
    <ScrollView contentContainerStyle={[styles.scroll, {
      paddingTop: Math.max(insets.top, 24), paddingBottom: Math.max(insets.bottom, 28),
      paddingLeft: Math.max(insets.left, wide ? 40 : 20), paddingRight: Math.max(insets.right, wide ? 40 : 20),
    }]}>
      <View style={styles.content}>
        <AppHeader actions={<Pressable accessibilityRole="button" onPress={onLeave} style={styles.linkButton}><Text style={{ color: colors.accent }}>Exit preview</Text></Pressable>} />
        {game ? <>
          <Pressable accessibilityRole="button" onPress={onBack} style={styles.back}><Text style={styles.link}>← All games</Text></Pressable>
          <Text style={styles.eyebrow}>GAME ROOM</Text>
          <Text accessibilityRole="header" style={styles.title}>{game.name}</Text>
          <View style={styles.emptyRoom}>
            <Text style={styles.emptySymbol}>{game.symbol}</Text>
            <Text accessibilityRole="header" style={styles.emptyTitle}>The table is taking shape.</Text>
            <Text style={styles.emptyText}>You’re in the {game.name} room preview. Tables and gameplay are coming next.</Text>
            <Pressable accessibilityRole="button" onPress={onBack} style={styles.button}><Text style={styles.buttonText}>Choose another game</Text></Pressable>
          </View>
        </> : <>
          <View style={styles.hero}>
            <Text style={styles.eyebrow}>PICK YOUR GAME</Text>
            <Text accessibilityRole="header" style={[styles.title, !wide && { fontSize: 44 }]}>What are we playing?</Text>
            <Text style={styles.subtitle}>Your friends. Your favorite game. Enter a room to get started.</Text>
          </View>
          <View style={[styles.grid, wide && styles.wideGrid]}>
            {games.map(item => <View key={item.id} style={[styles.card, wide && { flex: 1 }]}>
              <LinearGradient colors={[item.tint, colors.background]} style={styles.art}>
                <GameIcon game={item.id} size={144} />

              </LinearGradient>
              <View style={styles.cardBody}>
                <Text accessibilityRole="header" style={styles.gameName}>{item.name}</Text>
                <Text style={styles.description}>{item.description}</Text>
                <Text style={styles.detail}>{item.detail}</Text>
                <Pressable accessibilityRole="button" accessibilityLabel={`Enter ${item.name} game room`}
                  onPress={() => onSelect(item.id)} style={({ pressed }) => [styles.button, pressed && { opacity: 0.8 }]}>
                  <Text style={styles.buttonText}>Enter game room →</Text>
                </Pressable>
              </View>
            </View>)}
          </View>
        </>}
        <Text style={styles.preview}>Design preview · No live accounts, tables, or games.</Text>
        <Text style={styles.footer}>Good cards. Better company.</Text>
      </View>
    </ScrollView>
  </LinearGradient>;
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  page: { flex: 1 }, scroll: { flexGrow: 1, alignItems: 'center' }, content: { width: '100%', maxWidth: 1160 },
  topbar: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 12, paddingBottom: 22, borderBottomWidth: 1, borderColor: colors.border },
  brand: { fontFamily: fonts.display, fontSize: 31, color: colors.accent }, account: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  guest: { fontFamily: fonts.medium, fontSize: 13, color: colors.text }, linkButton: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 8 }, link: { fontFamily: fonts.body, fontSize: 12, color: colors.accent },
  hero: { paddingVertical: 40, gap: 12 }, eyebrow: { fontFamily: fonts.medium, fontSize: 10, letterSpacing: 3, color: colors.accent },
  title: { fontFamily: fonts.display, fontSize: 60, color: colors.text }, subtitle: { fontFamily: fonts.body, fontSize: 14, lineHeight: 23, color: colors.textMuted },
  grid: { gap: 22 }, wideGrid: { flexDirection: 'row' }, card: { backgroundColor: colors.surface, borderRadius: 18, overflow: 'hidden', minWidth: 0 },
  art: { height: 200, justifyContent: 'center', alignItems: 'center', gap: 12 }, symbol: { fontSize: 80, color: colors.accent },
  cardMotif: { fontFamily: fonts.display, color: colors.text, fontSize: 22, letterSpacing: 3 }, cardBody: { padding: 24, flex: 1 },
  gameName: { fontFamily: fonts.display, fontSize: 35, color: colors.text }, description: { fontFamily: fonts.body, fontSize: 13, lineHeight: 22, color: colors.textMuted, marginTop: 8, flex: 1 },
  detail: { fontFamily: fonts.medium, fontSize: 11, color: colors.accent, marginTop: 24, marginBottom: 18 },
  button: { minHeight: 48, justifyContent: 'center', alignItems: 'center', borderRadius: 9, padding: 14, backgroundColor: colors.surfaceSelected },
  buttonText: { fontFamily: fonts.medium, fontSize: 13, color: colors.text, textAlign: 'center' },
  preview: { fontFamily: fonts.body, fontSize: 11, lineHeight: 19, color: colors.textMuted, textAlign: 'center', marginTop: 28 },
  footer: { fontFamily: fonts.display, fontSize: 22, color: colors.textMuted, textAlign: 'center', marginTop: 18 },
  back: { minHeight: 56, justifyContent: 'center', marginTop: 12, alignSelf: 'flex-start' },
  emptyRoom: { backgroundColor: colors.surface, padding: 30, borderRadius: 18, marginTop: 26, gap: 20, maxWidth: 580 },
  emptySymbol: { fontSize: 60, color: colors.accent }, emptyTitle: { fontFamily: fonts.display, fontSize: 34, color: colors.text },
  emptyText: { fontFamily: fonts.body, fontSize: 14, lineHeight: 24, color: colors.textMuted },
});
