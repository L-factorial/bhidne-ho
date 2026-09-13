import { Image, StyleSheet, View } from 'react-native';
import { branding, gameIcons } from '../branding';

export function BrandLogo() {
  return <Image source={branding.logo} accessibilityLabel="Bhidne Ho" resizeMode="contain" style={styles.logo} />;
}
export function BrandIcon({ size = 44 }: { size?: number }) {
  return <Image source={branding.icon} accessibilityLabel="Bhidne Ho" resizeMode="contain" style={{ width: size, height: size, borderRadius: 10 }} />;
}
export function GameIcon({ game, size = 56 }: { game: keyof typeof gameIcons; size?: number }) {
  return <Image source={gameIcons[game]} accessible={false} resizeMode="contain" style={{ width: size, height: size, borderRadius: 12 }} />;
}
export function BrandBanner() {
  // Show only the central artwork: the supplied banner has painted navigation controls.
  return <View style={styles.banner} accessibilityLabel="Bhidne Ho" accessible>
    <Image source={branding.header} accessible={false} resizeMode="stretch" style={styles.bannerImage} />
  </View>;
}
const styles = StyleSheet.create({
  logo: { width: 112, height: 74, borderRadius: 8 },
  banner: { width: '100%', maxWidth: 440, aspectRatio: 440 / 216, alignSelf: 'center', overflow: 'hidden', borderRadius: 16 },
  bannerImage: { position: 'absolute', width: '227.273%', height: '100%', left: '-63.636%' },
});
