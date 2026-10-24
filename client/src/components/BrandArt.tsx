import { useUiLanguage } from '../i18n/useUiLanguage';
import { ui } from '../i18n/copy.ts';
import {createContext,useContext} from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import { branding } from '../branding';
import { GameArtwork, type GameArtworkKind } from './GameArtwork';

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
export function GameIcon({ game, size = 56 }: { game: GameArtworkKind; size?: number }) {
  return <View testID={`game-icon-${game}`} style={{width:size,height:size,flexShrink:0,borderRadius:size*0.21,overflow:'hidden'}}>
    <GameArtwork game={game} size={size}/>
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
