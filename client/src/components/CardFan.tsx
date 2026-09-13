import { StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { fonts, useTheme, useThemedStyles, type ThemeColors } from '../theme';

const cards = [
  { rank: 'K', suit: '♠', rotation: '-24deg', left: 26, top: 32, red: false },
  { rank: 'Q', suit: '♥', rotation: '-8deg', left: 92, top: 10, red: true },
  { rank: 'J', suit: '♣', rotation: '8deg', left: 158, top: 10, red: false },
  { rank: '10', suit: '♦', rotation: '24deg', left: 224, top: 32, red: true },
] as const;

export function CardFan({ compact = false }: { compact?: boolean }) {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  return (
    <View accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
      style={[styles.space, compact && styles.compactSpace]}>
      <View style={[styles.fan, compact && styles.compactFan]}>
        {cards.map(card => (
          <LinearGradient key={card.rank} colors={[colors.cardFace, colors.cardFace]} style={[
            styles.card, { left: card.left, top: card.top, transform: [{ rotate: card.rotation }] },
          ]}>
            <View style={styles.corner}>
              <Text style={[styles.rank, card.red && styles.red]}>{card.rank}</Text>
              <Text style={[styles.smallSuit, card.red && styles.red]}>{card.suit}</Text>
            </View>
            <Text style={[styles.suit, card.red && styles.red]}>{card.suit}</Text>
            <View style={styles.bottomCorner}>
              <Text style={[styles.rank, card.red && styles.red]}>{card.rank}</Text>
              <Text style={[styles.smallSuit, card.red && styles.red]}>{card.suit}</Text>
            </View>
          </LinearGradient>
        ))}
      </View>
    </View>
  );
}
const createStyles = (colors: ThemeColors) => StyleSheet.create({
  space: { width: 370, height: 280, alignItems: 'center' },
  compactSpace: { width: 260, height: 164 },
  fan: { width: 370, height: 280 },
  compactFan: { transform: [{ scale: 0.65 }], marginTop: -37 },
  card: { position: 'absolute', width: 120, height: 184, borderRadius: 12,
    borderWidth: 1, borderColor: colors.cardBorder, padding: 11, boxShadow: '0px 12px 22px rgba(0, 0, 0, 0.24)' },
  corner: { alignSelf: 'flex-start', alignItems: 'center' },
  bottomCorner: { position: 'absolute', right: 11, bottom: 11, alignItems: 'center', transform: [{ rotate: '180deg' }] },
  rank: { fontFamily: fonts.display, fontSize: 29, lineHeight: 30, color: colors.cardInk },
  smallSuit: { fontSize: 20, lineHeight: 24, color: colors.cardInk },
  suit: { position: 'absolute', alignSelf: 'center', top: 65, fontSize: 53, color: colors.cardInk },
  red: { color: colors.cardRed },
});
