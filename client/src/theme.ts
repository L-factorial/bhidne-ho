import { createContext, useContext, useMemo } from 'react';

// Semantic UI colors. Brand artwork and provider logos retain their original colors.
export const lightColors = {
  background: '#F7F1E7', header: '#FFF9F0', table: '#EADBC6',
  surface: '#FFFCF7', surfaceRaised: '#F5EEE4', surfaceSelected: '#F6E5B5',
  primary: '#7A1F2B', primaryPressed: '#59141D', onPrimary: '#FFF9F0',
  // `accent` is used by existing links/headings; keep it readable on neutral surfaces.
  accent: '#7A1F2B', attention: '#D59A2A', turnText: '#6B1924', turnSurface: '#F6E5B5',
  text: '#261C19', textMuted: '#74655E', border: '#D7C5B1', borderSubtle: '#E9DED0', disabled: '#B7AAA0',
  success: '#286047', successSurface: '#E3EFE6', danger: '#A92735', dangerSurface: '#F8E6E3', overlay: '#17111399',
  maalSeen: '#286047', maalUnseen: '#74655E',
  cardFace: '#FFFCF7', cardInk: '#211B19', cardRed: '#A92735', cardClub: '#211B19', cardBorder: '#DDD2C4',
  cardBack: '#741B25', cardPattern: '#8F2A37', cardBackBorder: '#D59A2A', cardInnerBorder: '#F0C96A', cardMark: '#F0C96A',
  cardSelected: '#FFFCF7', cardSelectedBorder: '#D59A2A',
  coin: '#D59A2A', coinBorder: '#845C15', onCoin: '#261C19',
  shadow: 'rgba(38,28,25,0.14)',
};
export type ThemeColors = typeof lightColors;
export const darkColors: ThemeColors = {
  background: '#171113', header: '#211518', table: '#2A211E',
  surface: '#241B1C', surfaceRaised: '#302628', surfaceSelected: '#3B3020',
  primary: '#A94352', primaryPressed: '#B64B5A', onPrimary: '#FFF9F0',
  accent: '#D6A84B', attention: '#D6A84B', turnText: '#F2D382', turnSurface: '#3B3020',
  text: '#F7EFE4', textMuted: '#B9AAA3', border: '#49383A', borderSubtle: '#36282B', disabled: '#6F6261',
  success: '#91C6A5', successSurface: '#20362A', danger: '#F19B9F', dangerSurface: '#412429', overlay: '#171113CC',
  maalSeen: '#91C6A5', maalUnseen: '#B9AAA3',
  cardFace: '#F8F3EA', cardInk: '#211B19', cardRed: '#A92735', cardClub: '#211B19', cardBorder: '#DDD2C4',
  cardBack: '#681923', cardPattern: '#4B1018', cardBackBorder: '#D6A84B', cardInnerBorder: '#9F762D', cardMark: '#E3BC65',
  cardSelected: '#F8F3EA', cardSelectedBorder: '#D6A84B',
  coin: '#D6A84B', coinBorder: '#9F762D', onCoin: '#211B19',
  shadow: 'rgba(12,7,9,0.24)',
};
export type ThemeMode = 'light' | 'dark';
export type ThemePreference = ThemeMode | 'system';
export const ThemeContext = createContext({ colors: darkColors, mode: 'dark' as ThemeMode,
  preference: 'system' as ThemePreference, setPreference: (_value: ThemePreference) => {}, toggle: () => {} });
export const useTheme = () => useContext(ThemeContext);
export function useThemedStyles<T>(factory: (colors: ThemeColors) => T): T {
  const { colors } = useTheme();
  return useMemo(() => factory(colors), [factory, colors]);
}
export function primaryAction(colors: ThemeColors, pressed = false) {
  return { backgroundColor: pressed ? colors.primaryPressed : colors.primary, borderColor: colors.primary };
}
export const fonts = { display: 'Inter_500Medium', body: 'Inter_400Regular', medium: 'Inter_500Medium' };
