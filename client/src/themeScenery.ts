import type { ImageSourcePropType } from 'react-native';
import type { TableThemeId } from './tableThemes';

// Static references keep the artwork bundled and usable offline on web and native.
const scenery: Partial<Record<TableThemeId, ImageSourcePropType>> = {
  noir: require('../assets/theme-scenery/kathmandu-ink.jpg'),
  pearl: require('../assets/theme-scenery/himali-bihan.jpg'),
  classic: require('../assets/theme-scenery/chitwan-hariyali.jpg'),
  heritage: require('../assets/theme-scenery/patan-sampada.jpg'),
  dusk: require('../assets/theme-scenery/himali-raat.jpg'),
};

export function themeScenery(id: TableThemeId) { return scenery[id]; }
