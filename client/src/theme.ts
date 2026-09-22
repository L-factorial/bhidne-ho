import { createContext, useContext, useMemo } from 'react';

// Semantic UI colors. Brand artwork and provider logos retain their original colors.
export const colors = {
  background: '#FAF4E9', header: '#FFF9F0', table: '#E1EBE3',
  surface: '#FFFCF7', surfaceRaised: '#F5EEE4', surfaceSelected: '#F6E5B5',
  primary: '#8B2035', primaryPressed: '#68172A', onPrimary: '#FFF9F0',
  // `accent` is used by existing links/headings; keep it readable on neutral surfaces.
  accent: '#7A1F2B', attention: '#D59A2A', turnText: '#6B1924', turnSurface: '#F6E5B5',
  text: '#261C19', textMuted: '#74655E', border: '#99867A', borderSubtle: '#E9DED0', disabled: '#B7AAA0',
  success: '#286047', successSurface: '#E3EFE6', danger: '#A92735', dangerSurface: '#F8E6E3', overlay: '#17111399',
  maalSeen: '#286047', maalUnseen: '#74655E',
  cardFace: '#FFFCF7', cardInk: '#211B19', cardRed: '#A92735', cardClub: '#211B19', cardBorder: '#DDD2C4',
  cardBack: '#741B25', cardPattern: '#8F2A37', cardBackBorder: '#D59A2A', cardInnerBorder: '#F0C96A', cardMark: '#F0C96A',
  cardSelected: '#FFFCF7', cardSelectedBorder: '#D59A2A',
  coin: '#D59A2A', coinBorder: '#845C15', onCoin: '#261C19',
  shadow: 'rgba(38,28,25,0.14)',
};
export type ThemeColors = typeof colors;
export const ThemeContext = createContext({ colors });
export const useTheme = () => useContext(ThemeContext);
export function useThemedStyles<T>(factory: (colors: ThemeColors) => T): T {
  const { colors } = useTheme();
  return useMemo(() => factory(colors), [factory, colors]);
}
export function primaryAction(colors: ThemeColors, pressed = false) {
  return { backgroundColor: pressed ? colors.primaryPressed : colors.primary, borderColor: colors.primary };
}
export const fonts = { editorial: 'CormorantGaramond_700Bold', display: 'Inter_500Medium', body: 'Inter_400Regular', medium: 'Inter_500Medium' };
