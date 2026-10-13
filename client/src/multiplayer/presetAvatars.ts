import type {ImageSourcePropType} from 'react-native';

export const presetAvatars:Record<string,ImageSourcePropType>={
  male_01:require('../../assets/avatars/male_01.webp'),
  male_02:require('../../assets/avatars/male_02.webp'),
  male_03:require('../../assets/avatars/male_03.webp'),
  male_04:require('../../assets/avatars/male_04.webp'),
  male_05:require('../../assets/avatars/male_05.webp'),
  male_06:require('../../assets/avatars/male_06.webp'),
  male_07:require('../../assets/avatars/male_07.webp'),
  male_08:require('../../assets/avatars/male_08.webp'),
  male_09:require('../../assets/avatars/male_09.webp'),
  male_10:require('../../assets/avatars/male_10.webp'),
  male_11:require('../../assets/avatars/male_11.webp'),
  male_12:require('../../assets/avatars/male_12.webp'),
  male_13:require('../../assets/avatars/male_13.webp'),
  male_14:require('../../assets/avatars/male_14.webp'),
  male_15:require('../../assets/avatars/male_15.webp'),
  female_01:require('../../assets/avatars/female_01.webp'),
  female_02:require('../../assets/avatars/female_02.webp'),
  female_03:require('../../assets/avatars/female_03.webp'),
  female_04:require('../../assets/avatars/female_04.webp'),
  female_05:require('../../assets/avatars/female_05.webp'),
  female_06:require('../../assets/avatars/female_06.webp'),
  female_07:require('../../assets/avatars/female_07.webp'),
  female_08:require('../../assets/avatars/female_08.webp'),
  female_09:require('../../assets/avatars/female_09.webp'),
  female_10:require('../../assets/avatars/female_10.webp'),
  female_11:require('../../assets/avatars/female_11.webp'),
  female_12:require('../../assets/avatars/female_12.webp'),
  female_13:require('../../assets/avatars/female_13.webp'),
  female_14:require('../../assets/avatars/female_14.webp'),
  female_15:require('../../assets/avatars/female_15.webp'),
};
export function avatarSource(uri?:string|null):ImageSourcePropType|undefined {
  if(!uri)return undefined;
  return uri.startsWith('preset:')?presetAvatars[uri.slice(7)]:{uri};
}
