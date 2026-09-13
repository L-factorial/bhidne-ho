import { createContext, useContext, useMemo } from 'react';

// Source palette from the supplied Bhidne Ho brand sheet.
export const brandColors = {
  burgundy: '#4B0D0D', crimson: '#CC1F2F', gold: '#F4C430',
  cream: '#F8EAD7', charcoal: '#1F1F1F', green: '#2E5D4F',
};
// Playing cards retain the same readable face and suit colors in either mode.
const cards = {
  cardFace: '#FFFCF6', cardInk: brandColors.charcoal, cardRed: '#B42332', cardClub: brandColors.charcoal,
  cardBorder: '#BFA98D', cardBack: brandColors.burgundy, cardPattern: '#8D4440', cardMark: brandColors.gold,
  cardSelected: '#FCE8AE', cardSelectedBorder: '#8A5A0A',
  coin: brandColors.gold, coinBorder: '#8A5A0A', onCoin: brandColors.burgundy,
};
export const darkColors = {
  ...cards,
  background: brandColors.charcoal, surface: '#2B2020', surfaceRaised: '#3B2B29', surfaceSelected: '#493819',
  text: brandColors.cream, textMuted: '#CEBCAF', border: '#80665B', accent: brandColors.gold,
  primary: brandColors.crimson, onPrimary: '#FFFFFF', success: '#9CD3B9', successSurface: '#203D33',
  // Pink is reserved for a player's turn and the action needed to start play.
  turnText: '#FFABBD', turnSurface: '#4B2230',
  danger: '#FFB4AB', dangerSurface: '#492624', overlay: '#160B0DDD',
  maalSeen: '#9CD3B9', maalUnseen: '#A5948A',
};
export type ThemeColors = typeof darkColors;
export const lightColors: ThemeColors = {
  ...cards,
  background: brandColors.cream, surface: '#FFFAF2', surfaceRaised: '#EFDFC9', surfaceSelected: '#F9E6AD',
  text: brandColors.charcoal, textMuted: '#70574E', border: '#A68D7C', accent: brandColors.burgundy,
  primary: brandColors.crimson, onPrimary: '#FFFFFF', success: brandColors.green, successSurface: '#E0EDE3',
  turnText: '#A31643', turnSurface: '#FCE0E7',
  danger: '#A3242F', dangerSurface: '#FBE3DF', overlay: '#160B0DAA',
  maalSeen: brandColors.green, maalUnseen: '#786A60',
};
export type ThemeMode = 'light' | 'dark';
export const ThemeContext = createContext({ colors: darkColors, mode: 'dark' as ThemeMode, toggle: () => {} });
export const useTheme = () => useContext(ThemeContext);
export function useThemedStyles<T>(factory: (colors: ThemeColors) => T): T {
  const { colors } = useTheme();
  return useMemo(() => factory(colors), [factory, colors]);
}
export const fonts = {
  display: 'Inter_500Medium', body: 'Inter_400Regular', medium: 'Inter_500Medium',
};
