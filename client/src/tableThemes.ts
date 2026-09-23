import { gameColors, type ThemeColors } from './theme.ts';

export const tableThemes = {
  classic: { name: 'Classic Green', description: 'Green felt and polished wood', felt: ['#137C52', '#03412E'], trim: '#B88A53', colors: gameColors },
  heritage: { name: 'Nepali Heritage', description: 'Paral, a village house and a chautari', felt: ['#72502F', '#35261C'], trim: '#D4AD69', colors: {
    ...gameColors, background: '#241C16', header: '#241C16', table: '#35261C', surface: '#30231B', surfaceRaised: '#493426', surfaceSelected: '#59402A',
    textMuted: '#DFCCB4', border: '#B49A7A', borderSubtle: '#634B35', primarySoft: '#493426', tableHeader: '#302117', tableTrim: '#D4AD69', resultOwnSurface: '#493426', ownMessage: '#59402A',
  } as ThemeColors },
  dusk: { name: 'Himalayan Dusk', description: 'Mountain silhouettes beneath an evening sky', felt: ['#38476B', '#1C243E'], trim: '#ADA4CC', colors: {
    ...gameColors, background: '#151B2C', header: '#151B2C', table: '#202A43', surface: '#20283D', surfaceRaised: '#303B55', surfaceSelected: '#3B4663',
    textMuted: '#CBD0E2', border: '#939FBF', borderSubtle: '#424D69', primarySoft: '#303B55', tableHeader: '#1B2238', tableTrim: '#ADA4CC', resultOwnSurface: '#303B55', ownMessage: '#3B4663',
  } as ThemeColors },
};
export type TableThemeId = keyof typeof tableThemes;
export function isTableThemeId(value: unknown): value is TableThemeId {
  return typeof value === 'string' && Object.hasOwn(tableThemes, value);
}
