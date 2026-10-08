import type { ImageSourcePropType } from 'react-native';
import type { CardThemeId } from './cardThemeCatalog';

// Static bundled assets work offline and are shared by previews and hidden cards.
export const cardThemeImages: Record<CardThemeId, ImageSourcePropType> = {
  kathmandu: require('../assets/card-backs/kathmandu.jpg'),
  everest: require('../assets/card-backs/everest.jpg'),
  boudhanath: require('../assets/card-backs/boudhanath.jpg'),
  pokhara: require('../assets/card-backs/pokhara.jpg'),
  pashupatinath: require('../assets/card-backs/pashupatinath.jpg'),
  chitwan: require('../assets/card-backs/chitwan.jpg'),
  bhaktapur: require('../assets/card-backs/bhaktapur.jpg'),
  rara: require('../assets/card-backs/rara.jpg'),
  lumbini: require('../assets/card-backs/lumbini.jpg'),
  annapurna: require('../assets/card-backs/annapurna.jpg'),
};
