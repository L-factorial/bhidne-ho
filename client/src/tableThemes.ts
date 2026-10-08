import { gameColors, type ThemeColors } from './theme.ts';

// Neutral interface palettes; playing-card suit colors remain recognizable.
const noir: ThemeColors = {
  ...gameColors,
  background:'#101113',header:'#101113',table:'#1D1F22',surface:'#1D1F22',surfaceRaised:'#292C30',surfaceSelected:'#2B2B2B',
  text:'#F5F5F5',textMuted:'#BDBDBD',accent:'#E0E0E0',border:'#777777',borderSubtle:'#383838',disabled:'#666666',
  primaryBorder:'#858585',primary:'#E8E8E8',primaryPressed:'#CCCCCC',onPrimary:'#111111',primarySoft:'#252525',
  attention:'#D8D8D8',turnText:'#F5F5F5',turnSurface:'#303030',
  success:'#D8D8D8',successSurface:'#262626',danger:'#FF9DAB',dangerSurface:'#492630',warning:'#D8D8D8',warningSoft:'#262626',
  maalSeen:'#F5F5F5',maalUnseen:'#BDBDBD',overlay:'#000000B3',shadow:'rgba(0,0,0,0.32)',
  tableHeader:'#181818',onTableHeader:'#F5F5F5',tableTrim:'#858585',tableGreen:'#202020',
  ownMessage:'#292929',resultOwnSurface:'#292929',coin:'#D8D8D8',coinBorder:'#A0A0A0',onCoin:'#111111',
  cardBack:'#202020',cardPattern:'#353535',cardBackBorder:'#888888',cardInnerBorder:'#D8D8D8',cardMark:'#D8D8D8',cardSelectedBorder:'#777777',
};
const pearl: ThemeColors = {
  ...noir,
  background:'#F5F4F0',header:'#F5F4F0',table:'#EAE9E5',surface:'#FFFFFF',surfaceRaised:'#EAE9E5',surfaceSelected:'#E6E6E6',
  text:'#161616',textMuted:'#575757',accent:'#292929',border:'#858585',borderSubtle:'#D6D6D6',disabled:'#999999',
  primary:'#1C1C1C',primaryPressed:'#363636',onPrimary:'#FFFFFF',primarySoft:'#EEEEEE',
  attention:'#444444',turnText:'#161616',turnSurface:'#E6E6E6',
  success:'#353535',successSurface:'#EEEEEE',gain:'#167344',loss:'#B42335',danger:'#B42335',dangerSurface:'#FBE8EA',warning:'#353535',warningSoft:'#EEEEEE',
  maalSeen:'#161616',maalUnseen:'#575757',overlay:'#00000066',shadow:'rgba(0,0,0,0.08)',
  tableHeader:'#F5F5F5',onTableHeader:'#161616',tableTrim:'#858585',tableGreen:'#E6E6E6',
  ownMessage:'#E6E6E6',resultOwnSurface:'#E6E6E6',coin:'#252525',coinBorder:'#555555',onCoin:'#FFFFFF',
};
export const tableThemes = {
  noir: { name: 'Monochrome Noir', description: 'Soft black, silver edges and crisp white type', felt: ['#242424', '#101010'], trim: '#858585', colors: noir },
  pearl: { name: 'Monochrome Pearl', description: 'Soft white, graphite type and quiet depth', felt: ['#FFFFFF', '#E8E8E8'], trim: '#858585', colors: pearl },
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
