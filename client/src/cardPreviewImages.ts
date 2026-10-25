import type { ImageSourcePropType } from 'react-native';
import type { CardThemeId } from './cardThemeCatalog';

// Small artwork for the empty Play card; full-size playing cards remain unchanged.
export const cardPreviewImages: Record<CardThemeId, ImageSourcePropType> = {
  kathmandu: require('../assets/card-previews/kathmandu.jpg'),
  everest: require('../assets/card-previews/everest.jpg'),
  boudhanath: require('../assets/card-previews/boudhanath.jpg'),
  pokhara: require('../assets/card-previews/pokhara.jpg'),
  pashupatinath: require('../assets/card-previews/pashupatinath.jpg'),
  chitwan: require('../assets/card-previews/chitwan.jpg'),
  bhaktapur: require('../assets/card-previews/bhaktapur.jpg'),
  rara: require('../assets/card-previews/rara.jpg'),
  lumbini: require('../assets/card-previews/lumbini.jpg'),
  annapurna: require('../assets/card-previews/annapurna.jpg'),
};
