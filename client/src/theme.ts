import { createContext, useContext, useMemo } from 'react';

// Semantic UI colors. Brand artwork and provider logos retain their original colors.
export const colors = {
  background: '#F8F6F2', header: '#F8F6F2', table: '#DCEBE5',
  surface: '#FFFFFF', surfaceRaised: '#F5F0E8', surfaceSelected: '#E6E6E6',
  primaryBorder: '#1A1A1A', primary: '#1A1A1A', primaryPressed: '#333333', onPrimary: '#FFFFFF',
  // `accent` is used by existing links/headings; keep it readable on neutral surfaces.
  accent: '#222222', attention: '#D5A12A', turnText: '#6B1924', turnSurface: '#F6E5B5',
  text: '#1A1A1A', textMuted: '#686868', border: '#99867A', borderSubtle: '#E5DDD3', disabled: '#B7AAA0',
  gain: '#167344', loss: '#B42335', destructiveAction: '#AD2440', onDestructive: '#FFFFFF',
  success: '#167344', successSurface: '#E5F4EC', danger: '#B42335', dangerSurface: '#FBE8EA', overlay: '#17111399',
  maalSeen: '#167344', maalUnseen: '#6F655F',
  cardFace: '#FFFCF7', cardInk: '#211B19', cardRed: '#B42335', cardClub: '#211B19', cardBorder: '#DDD2C4',
  cardBack: '#741B25', cardPattern: '#8F2A37', cardBackBorder: '#D5A12A', cardInnerBorder: '#F0C96A', cardMark: '#F0C96A',
  cardSelected: '#FFFCF7', cardSelectedBorder: '#D5A12A',
  coin: '#D5A12A', coinBorder: '#845C15', onCoin: '#211D1B',
  primarySoft: '#F6E8EA', tableGreen: '#0F4D3A', warning: '#976119', warningSoft: '#FFF2D6',
  shadow: 'rgba(38,28,25,0.14)',
  tableHeader: '#0A382B', onTableHeader: '#FFF8EB', tableTrim: '#A17C45', ownMessage: '#F6E8EA', resultOwnSurface: '#F6E8EA',
};
export type ThemeColors = typeof colors;
// Shared game palette; the selected theme applies throughout the app.
export const gameColors: ThemeColors = {
  ...colors,
  background: '#062B23', header: '#062B23', table: '#07382B',
  surface: '#0E3A2E', surfaceRaised: '#164638', surfaceSelected: '#173E32',
  resultOwnSurface: '#164638', ownMessage: '#173E32',
  text: '#FAF0E4', textMuted: '#A9C2B7', accent: '#D4A62C',
  border: '#7E947F', borderSubtle: '#265445', primarySoft: '#173E32',
  primaryBorder: '#DB5670', primary: '#B32643', primaryPressed: '#8D1C35', onPrimary: '#FFFFFF',
  gain: '#7DE0A5', loss: '#FF9DAB',
  success: '#7DE0A5', successSurface: '#123E2B', danger: '#FF9DAB', dangerSurface: '#492630',
  warning: '#F0C96A', warningSoft: '#493A20',
  maalSeen: '#7DE0A5', maalUnseen: '#C6D2C8',
  tableHeader: '#082E24', shadow: 'rgba(0,0,0,0.3)',
};
export const gameTheme = { colors: gameColors };
export const roomTheme = { colors };
export const ThemeContext = createContext({ colors });
export const useTheme = () => useContext(ThemeContext);
export function useThemedStyles<T>(factory: (colors: ThemeColors) => T): T {
  const { colors } = useTheme();
  return useMemo(() => factory(colors), [factory, colors]);
}
export function primaryAction(colors: ThemeColors, pressed = false) {
  return { backgroundColor: pressed ? colors.primaryPressed : colors.primary, borderColor: colors.primary };
}
export const fonts = { card: 'CormorantGaramond_700Bold', editorial: 'LibreBaskerville_700Bold', display: 'LibreBaskerville_700Bold', body: 'Inter_400Regular', medium: 'Inter_500Medium' };

export const space = { xxs: 2, xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, section: 32 } as const;
export const radii = { small: 8, medium: 12, large: 18, xl: 20 } as const;
export const typography = { display: 42, brand: 26, pageTitle: 22, sectionTitle: 22, cardTitle: 20, body: 16, metadata: 14, caption: 14, tab: 15, navigation: 14 } as const;

/** Visual finishes only: preserve each screen's dimensions and spacing. */
export function gameControlFinish(c: ThemeColors, pressed = false) {
  return {
    borderRadius: radii.medium,
    borderWidth: 1,
    borderColor: c.borderSubtle,
    backgroundColor: pressed ? c.surfaceRaised : c.surface,
    boxShadow: pressed ? `inset 0px 1px 3px ${c.shadow}` : `0px 2px 4px ${c.shadow}`,
  };
}
export function gamePanelFinish(c: ThemeColors) {
  return { borderRadius: radii.large, borderWidth: 1, borderColor: c.borderSubtle, boxShadow: `0px 4px 12px ${c.shadow}` };
}
export function gameTabFinish(c: ThemeColors, selected = false, pressed = false) {
  return { ...gameControlFinish(c, pressed), borderColor: selected ? c.accent : c.borderSubtle, backgroundColor: selected ? c.coin : pressed ? c.surfaceRaised : c.surface };
}
export function gameSeparatorFinish(c: ThemeColors) {
  return { borderColor: c.borderSubtle, boxShadow: `0px 2px 0px ${c.background}, 0px 3px 0px ${c.borderSubtle}` };
}
export function gameHeadingFinish(c: ThemeColors) {
  return { textShadowColor: c.shadow, textShadowOffset: { width: 0, height: 2 }, textShadowRadius: 4 };
}

// Shared card-area controls use the active theme action and surface colors.
export function gameButtonStyle(c: ThemeColors, variant: 'primary' | 'secondary' = 'secondary', pressed = false) {
  return {
    minHeight: 44, minWidth: 44, borderRadius: radii.medium, borderWidth: 1,
    paddingHorizontal: 12, paddingVertical: 10,
    backgroundColor: variant === 'primary' ? (pressed ? c.primaryPressed : c.primary) : (pressed ? c.surfaceRaised : c.tableHeader),
    borderColor: variant === 'primary' ? c.primaryBorder : c.borderSubtle,
    boxShadow: gameControlFinish(c, pressed).boxShadow,
  };
}

/** Shared action finishes; callers retain their existing dimensions and placement. */
export function actionFinish(c: ThemeColors, variant: 'primary' | 'secondary' | 'tertiary' | 'destructive' | 'selected' = 'secondary', pressed = false, disabled = false) {
  const backgroundColor = variant === 'primary' ? (pressed ? c.primaryPressed : c.primary)
    : variant === 'destructive' ? c.dangerSurface : variant === 'selected' ? c.surfaceSelected
    : variant === 'tertiary' ? (pressed ? c.surfaceRaised : 'transparent') : pressed ? c.surfaceRaised : c.surface;
  return { borderRadius: radii.medium, borderWidth: 1,
    borderColor: variant === 'selected' ? c.accent : variant === 'primary' ? c.primaryBorder : variant === 'tertiary' ? 'transparent' : c.borderSubtle,
    backgroundColor, opacity: disabled ? visualStates.disabledOpacity : pressed && (variant === 'selected' || variant === 'destructive') ? visualStates.pressedOpacity : 1 };
}
export const visualStates = { disabledOpacity: 0.55, pressedOpacity: 0.85 } as const;
export const iconStyle = { inline: 20, navigation: 24, strokeWidth: 1.8 } as const;
