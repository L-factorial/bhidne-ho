import { useUiLanguage } from '../i18n/useUiLanguage';
import { ui } from '../i18n/copy.ts';
import { Image, StyleSheet, View } from 'react-native';
import { branding, gameIcons } from '../branding';

export function BrandLogo({ size = headerLogoSize }: { size?: number }) {
  useUiLanguage();
  return <Image source={branding.logo} accessibilityLabel={ui("common.brand_name")} resizeMode="contain" style={{ width: size * 727 / 385, height: size, flexShrink: 0 }} />;
}
// One in-app size, approximately 10% larger than the former 52px mobile logo.
export const headerLogoSize = 57;

export function BrandIcon({ size = headerLogoSize }: { size?: number }) {
  useUiLanguage();
  return <Image source={branding.icon} accessibilityLabel={ui("common.brand_name")} resizeMode="contain" style={{ width: size, height: size, flexShrink: 0, borderRadius: 10 }} />;
}
export function GameIcon({ game, size = 56 }: { game: keyof typeof gameIcons; size?: number }) {
  useUiLanguage();
  return <Image source={gameIcons[game]} accessible={false} resizeMode="contain" style={{ width: size, height: size, borderRadius: 12 }} />;
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
