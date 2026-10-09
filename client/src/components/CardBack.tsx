import { Image, StyleSheet, View } from 'react-native';
import { useCardTheme } from '../CardThemeProvider';
import { cardThemeImages } from '../cardThemeImages';

// One back for every hidden card: artwork never depends on a card's identity.
export function CardBack({ testID = 'card-back', size }: { testID?: string; size?: 'small' | 'medium' | 'large' }) {
  const { id } = useCardTheme();
  const dimensions = size ? { width: { small: 44, medium: 58, large: 80 }[size], aspectRatio: 50 / 74 } : StyleSheet.absoluteFill;
  return <View testID={testID} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
    style={[dimensions, { borderRadius: 5, overflow: 'hidden' }]}>
    <Image testID={`card-back-art-${id}`} source={cardThemeImages[id]} accessible={false} resizeMode="cover"
      style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: '100%' }} />
  </View>;
}
