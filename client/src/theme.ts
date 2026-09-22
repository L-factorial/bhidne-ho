import type { Session } from './multiplayer/session';
import { createContext, useContext, useMemo } from 'react';

// Semantic UI colors. Brand artwork and provider logos retain their original colors.
export const lightColors = {
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
export type ThemeColors = typeof lightColors;
export const darkColors: ThemeColors = {
  background: '#191517', header: '#211518', table: '#20352A',
  surface: '#292124', surfaceRaised: '#302628', surfaceSelected: '#3B3020',
  primary: '#F0A0AE', primaryPressed: '#DC8999', onPrimary: '#30131B',
  accent: '#D6A84B', attention: '#D6A84B', turnText: '#F2D382', turnSurface: '#3B3020',
  text: '#F7EFE4', textMuted: '#B9AAA3', border: '#8D747C', borderSubtle: '#36282B', disabled: '#6F6261',
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
export type ThemeFamily = 'heritage' | 'himalayan' | 'courtyard';
export type Appearance = { theme: ThemeFamily; mode: ThemePreference };
export const themeFamilies: ThemeFamily[] = ['heritage', 'himalayan', 'courtyard'];
export const palettes: Record<ThemeFamily, Record<ThemeMode, ThemeColors>> = {
  heritage: { light: lightColors, dark: darkColors },
  himalayan: {
    light: { ...lightColors, background: '#F3F7FB', header: '#F8FAFE', surface: '#FFFFFF', surfaceRaised: '#EAF0F8',
      surfaceSelected: '#DFEAF8', text: '#182B40', textMuted: '#57677C', primary: '#24558A', primaryPressed: '#1A426E',
      onPrimary: '#FFFFFF', accent: '#24558A', border: '#7B8CA3', borderSubtle: '#DCE4EF', table: '#DCE7EF',
      turnText: '#294975', turnSurface: '#DFEAF8', cardBack: '#213F65', cardPattern: '#34567D', shadow: 'rgba(24,43,64,0.12)' },
    dark: { ...darkColors, background: '#101C2C', header: '#152237', surface: '#1D2D42', surfaceRaised: '#293C54',
      surfaceSelected: '#304862', text: '#F3F7FB', textMuted: '#B2C3D9', primary: '#99C9F4', primaryPressed: '#80B7E8',
      onPrimary: '#142B42', accent: '#99C9F4', border: '#7186A0', borderSubtle: '#34465D', table: '#172F44',
      turnText: '#E4CE91', turnSurface: '#3D3524', cardBack: '#213F65', cardPattern: '#172D4C', shadow: 'rgba(5,13,26,0.3)' },
  },
  courtyard: {
    light: { ...lightColors, background: '#F5F4E9', header: '#FAFAF1', surface: '#FFFFFA', surfaceRaised: '#EBEFE3',
      surfaceSelected: '#DDEFE3', text: '#20382D', textMuted: '#526357', primary: '#256247', primaryPressed: '#194C35',
      onPrimary: '#FFFFFF', accent: '#256247', border: '#7B907F', borderSubtle: '#DBE2D5', table: '#D9E6D9',
      turnText: '#28513B', turnSurface: '#DDEFE3', cardBack: '#25503B', cardPattern: '#396650', shadow: 'rgba(32,56,45,0.12)' },
    dark: { ...darkColors, background: '#111F19', header: '#17271F', surface: '#203129', surfaceRaised: '#2C4035',
      surfaceSelected: '#344D3E', text: '#F5F4E9', textMuted: '#B5C8BB', primary: '#A0D5B4', primaryPressed: '#87C49E',
      onPrimary: '#142D1E', accent: '#A0D5B4', border: '#768F7E', borderSubtle: '#354A3D', table: '#183C2A',
      turnText: '#F0D99D', turnSurface: '#3D3524', cardBack: '#25503B', cardPattern: '#193D2B', shadow: 'rgba(5,18,11,0.3)' },
  },
};
export function validAppearance(value: unknown): value is Appearance {
  const candidate = value as Appearance | undefined;
  return !!candidate && themeFamilies.includes(candidate.theme) && ['light', 'dark', 'system'].includes(candidate.mode);
}
export const ThemeContext = createContext({ colors: lightColors, mode: 'light' as ThemeMode,
  preference: 'system' as ThemePreference, family: 'heritage' as ThemeFamily,
  setPreference: (_value: ThemePreference) => {}, setFamily: (_value: ThemeFamily) => {},
  bindSession: (_value: Session | null) => {}, syncStatus: 'local' as 'local' | 'saving' | 'saved' | 'pending',
  toggle: () => {} });
export const useTheme = () => useContext(ThemeContext);
export function useThemedStyles<T>(factory: (colors: ThemeColors) => T): T {
  const { colors } = useTheme();
  return useMemo(() => factory(colors), [factory, colors]);
}
export function primaryAction(colors: ThemeColors, pressed = false) {
  return { backgroundColor: pressed ? colors.primaryPressed : colors.primary, borderColor: colors.primary };
}
export const fonts = { editorial: 'CormorantGaramond_700Bold', display: 'Inter_500Medium', body: 'Inter_400Regular', medium: 'Inter_500Medium' };
