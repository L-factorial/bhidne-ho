import { createContext, useContext, useMemo } from 'react';

// Semantic UI colors. Brand artwork and provider logos retain their original colors.
export const colors = {
  background: '#FAF7F1', header: '#FAF7F1', table: '#DCEBE5',
  surface: '#FFFFFF', surfaceRaised: '#F5F0E8', surfaceSelected: '#F6E5B5',
  primary: '#9B1F36', primaryPressed: '#7A182B', onPrimary: '#FAF7F1',
  // `accent` is used by existing links/headings; keep it readable on neutral surfaces.
  accent: '#7A1F2B', attention: '#D5A12A', turnText: '#6B1924', turnSurface: '#F6E5B5',
  text: '#211D1B', textMuted: '#6F655F', border: '#99867A', borderSubtle: '#E5DDD3', disabled: '#B7AAA0',
  success: '#167344', successSurface: '#E5F4EC', danger: '#B42335', dangerSurface: '#FBE8EA', overlay: '#17111399',
  maalSeen: '#167344', maalUnseen: '#6F655F',
  cardFace: '#FFFCF7', cardInk: '#211B19', cardRed: '#B42335', cardClub: '#211B19', cardBorder: '#DDD2C4',
  cardBack: '#741B25', cardPattern: '#8F2A37', cardBackBorder: '#D5A12A', cardInnerBorder: '#F0C96A', cardMark: '#F0C96A',
  cardSelected: '#FFFCF7', cardSelectedBorder: '#D5A12A',
  coin: '#D5A12A', coinBorder: '#845C15', onCoin: '#211D1B',
  primarySoft: '#F6E8EA', tableGreen: '#0F4D3A', warning: '#976119', warningSoft: '#FFF2D6',
  shadow: 'rgba(38,28,25,0.14)',
  tableHeader: '#0A382B', onTableHeader: '#FFF8EB', tableTrim: '#A17C45', ownMessage: '#E5F4EC',
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

export const space = { xxs: 2, xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, section: 32 } as const;
export const radii = { small: 8, medium: 12, large: 18, xl: 24 } as const;
export const typography = { display: 42, pageTitle: 30, sectionTitle: 22, cardTitle: 18, body: 15, metadata: 13, caption: 11 } as const;
