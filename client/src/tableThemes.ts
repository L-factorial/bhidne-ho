import { gameColors, type ThemeColors } from './theme.ts';

// Neutral interface palettes; playing-card suit colors remain recognizable.
const noir: ThemeColors = {
  ...gameColors,
  background:'#101112',header:'#101112',table:'#1E1F22',surface:'#1E1F22',surfaceRaised:'#292C30',surfaceSelected:'#2B2B2B',
  text:'#F2F2F2',textMuted:'#B0B0B0',accent:'#DDDDDD',border:'#777777',borderSubtle:'#383838',disabled:'#666666',
  primaryBorder:'#858585',primary:'#E5E5E5',primaryPressed:'#CCCCCC',onPrimary:'#111111',primarySoft:'#252525',
  attention:'#D8D8D8',turnText:'#F2F2F2',turnSurface:'#303030',
  success:'#D8D8D8',successSurface:'#262626',danger:'#FF9DAB',dangerSurface:'#492630',warning:'#D8D8D8',warningSoft:'#262626',
  maalSeen:'#F2F2F2',maalUnseen:'#B0B0B0',overlay:'#000000B3',shadow:'rgba(0,0,0,0.32)',
  tableHeader:'#181818',onTableHeader:'#F2F2F2',tableTrim:'#858585',tableGreen:'#202020',
  ownMessage:'#222222',resultOwnSurface:'#222222',coin:'#D8D8D8',coinBorder:'#A0A0A0',onCoin:'#111111',
  cardBack:'#202020',cardPattern:'#353535',cardBackBorder:'#888888',cardInnerBorder:'#D8D8D8',cardMark:'#D8D8D8',cardSelectedBorder:'#777777',
};
const pearl: ThemeColors = {
  ...noir,
  background:'#F8F6F2',header:'#F8F6F2',table:'#EAE9E5',surface:'#FFFFFF',surfaceRaised:'#EAE9E5',surfaceSelected:'#E6E6E6',
  text:'#1A1A1A',textMuted:'#626262',accent:'#222222',border:'#858585',borderSubtle:'#D6D6D6',disabled:'#999999',
  primary:'#1A1A1A',primaryPressed:'#363636',onPrimary:'#FFFFFF',primarySoft:'#EEEEEE',
  attention:'#444444',turnText:'#1A1A1A',turnSurface:'#E6E6E6',
  success:'#353535',successSurface:'#EEEEEE',gain:'#167344',loss:'#B42335',danger:'#B42335',dangerSurface:'#FBE8EA',warning:'#353535',warningSoft:'#EEEEEE',
  maalSeen:'#1A1A1A',maalUnseen:'#626262',overlay:'#00000066',shadow:'rgba(0,0,0,0.08)',
  tableHeader:'#F2F2F2',onTableHeader:'#1A1A1A',tableTrim:'#858585',tableGreen:'#E6E6E6',
  ownMessage:'#E6E6E6',resultOwnSurface:'#E6E6E6',coin:'#252525',coinBorder:'#555555',onCoin:'#FFFFFF',
};
export const tableThemes = {
  noir: { name: 'Charcoal Monochrome', description: 'Soft black, silver edges and crisp white type', felt: ['#242424', '#101010'], trim: '#858585', colors: noir },
  pearl: { name: 'Ivory Light', description: 'Soft white, graphite type and quiet depth', felt: ['#FFFFFF', '#E5E5E5'], trim: '#858585', colors: pearl },
  classic: { name: 'Evergreen Green', description: 'Green felt and polished wood', felt: ['#0E3A2E', '#062B23'], trim: '#B88A53', colors: gameColors },
  heritage: { name: 'Espresso Brown', description: 'Warm, traditional, elegant', felt: ['#32251E', '#32251E'], trim: '#D4AD69', colors: {
    ...gameColors, background: '#241B16', header: '#241B16', table: '#32251E', surface: '#32251E', surfaceRaised: '#3B2B21', surfaceSelected: '#3B2B21',
    text: '#F4E7D3', textMuted: '#C7B299', border: '#B49A7A', borderSubtle: '#5A4230', primarySoft: '#3B2B21', tableHeader: '#302117', tableTrim: '#D4AD69', resultOwnSurface: '#3B2B21', ownMessage: '#3B2B21',
  } as ThemeColors },
  dusk: { name: 'Midnight Navy', description: 'Premium, balanced', felt: ['#1E2740', '#141A2B'], trim: '#D4A62C', colors: {
    ...gameColors, background: '#141A2B', header: '#141A2B', table: '#1E2740', surface: '#1E2740', surfaceRaised: '#24304A', surfaceSelected: '#24304A',
    text: '#F4EAD7', textMuted: '#A9B3D1', border: '#939FBF', borderSubtle: '#32426B', primarySoft: '#24304A', tableHeader: '#1B2238', tableTrim: '#D4A62C', resultOwnSurface: '#24304A', ownMessage: '#24304A',
  } as ThemeColors },
};
export type TableThemeId = keyof typeof tableThemes;
export function isTableThemeId(value: unknown): value is TableThemeId {
  return typeof value === 'string' && Object.hasOwn(tableThemes, value);
}
