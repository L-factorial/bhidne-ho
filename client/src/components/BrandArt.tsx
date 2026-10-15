import { useUiLanguage } from '../i18n/useUiLanguage';
import { ui } from '../i18n/copy.ts';
import {createContext,useContext} from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import { branding, gameIcons } from '../branding';

export const HeaderHomeContext=createContext<(()=>void)|null>(null);

export function BrandLogo({ size = headerLogoSize }: { size?: number }) {
  useUiLanguage();
  const home=useContext(HeaderHomeContext);
  const logo=<Image source={branding.logo} accessibilityLabel={ui("common.brand_name")} resizeMode="contain" style={{ width: size * 727 / 385, height: size, flexShrink: 0 }} />;
  return home?<Pressable testID="header-home-logo" accessibilityRole="button" accessibilityLabel={ui('common.home')} onPress={home} style={{minHeight:44,justifyContent:'center',flexShrink:0}}>{logo}</Pressable>:logo;
}
// One in-app size, approximately 10% larger than the former 52px mobile logo.
export const headerLogoSize = 57;

export function BrandIcon({ size = headerLogoSize }: { size?: number }) {
  useUiLanguage();
  return <Image source={branding.icon} accessibilityLabel={ui("common.brand_name")} resizeMode="contain" style={{ width: size, height: size, flexShrink: 0, borderRadius: 10 }} />;
}
export function GameIcon({ game, size = 56 }: { game: keyof typeof gameIcons; size?: number }) {
  useUiLanguage();
  // The bundled artwork includes off-white export padding. Crop its red face
  // inside a proportional rounded frame instead of displaying that backing.
  const crop = game === 'flush' ? {width:161,x:7,y:3,w:147,h:141}
    : game === 'marriage' ? {width:160,x:7,y:3,w:146,h:143}
    : {width:154,x:6,y:4,w:144,h:137};
  return <View testID={`game-icon-${game}`} style={{width:size,height:size,flexShrink:0,borderRadius:size*0.21,overflow:'hidden'}}>
    <Image source={gameIcons[game]} accessible={false} resizeMode="stretch" style={{position:'absolute',
      width:size*crop.width/crop.w,height:size*155/crop.h,left:-size*crop.x/crop.w,top:-size*crop.y/crop.h}} />
  </View>;
}
export function BrandBanner() {
  useUiLanguage();
  return <View style={styles.banner} accessibilityLabel={ui("common.brand_name")} accessible>
    <Image source={branding.landing} accessible={false} resizeMode="contain" style={styles.bannerImage} />
  </View>;
}
const styles = StyleSheet.create({
  banner: { width: '100%', maxWidth: 440, aspectRatio: 1090 / 650, alignSelf: 'center' },
  bannerImage: { width: '100%', height: '100%' },
});
