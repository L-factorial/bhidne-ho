import { ThemeToggle } from '../components/ThemeToggle';
import { useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { branding } from '../branding';
import { BrandBanner } from '../components/BrandArt';
import { SignInButton, SignInMethod } from '../components/SignInButton';
import { fonts, useTheme, useThemedStyles, type ThemeColors } from '../theme';

export function WelcomeScreen({ onEnterLobby }: { onEnterLobby: () => void }) {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const wide = width >= 1024;
  const [notice, setNotice] = useState('');
  function selectMethod(method: SignInMethod) {
    if (method === 'guest') { onEnterLobby(); return; }
    setNotice(`${method} sign-in is coming next. Choose Play as guest to preview the lobby.`);
  }
  return (
    <LinearGradient colors={[colors.surface, colors.background, colors.background]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.page}>
      <View pointerEvents="none" style={styles.halo} />
      <ScrollView contentContainerStyle={[styles.scroll, {
        paddingTop: Math.max(insets.top, wide ? 40 : 24), paddingBottom: Math.max(insets.bottom, 24),
        paddingLeft: Math.max(insets.left, wide ? 40 : 16), paddingRight: Math.max(insets.right, wide ? 40 : 16),
      }]}>
        <View style={[styles.layout, wide && styles.wideLayout]}>
          <View style={[styles.brandSide, wide && styles.wideBrand]}>
            <ThemeToggle />
            {wide ? <Image source={branding.splash} accessibilityLabel="Bhidne Ho — friends playing cards in Nepal. More than a game, it’s our time." resizeMode="contain" style={{ width: '100%', aspectRatio: 507 / 953, maxHeight: 760, marginTop: 16, borderRadius: 20 }} /> : <>
              <BrandBanner />
              <View style={styles.mobileIntro}>
                <Text accessibilityRole="header" style={styles.mobileHeading}>Take your seat.</Text>
                <Text style={styles.mobileSubtitle}>Call Break, Marriage and Flush with friends.</Text>
              </View>
            </>}
          </View>
          <View style={[styles.panel, wide ? styles.widePanel : styles.mobilePanel]}>
            {wide && <View style={styles.intro}>
              <Text accessibilityRole="header" style={styles.heading}>Take your seat.</Text>
              <Text style={styles.subtitle}>Call Break, Marriage and Flush with friends.</Text>
            </View>}
            <View style={styles.buttons}>
              {(['Apple', 'Google', 'Facebook'] as const).map(method => (
                <SignInButton key={method} method={method} onPress={() => selectMethod(method)} />
              ))}
            </View>
            <View style={styles.divider}><View style={styles.dividerLine} /><Text style={styles.or}>or</Text><View style={styles.dividerLine} /></View>
            <SignInButton method="guest" onPress={() => selectMethod('guest')} />
            <Text style={styles.helper}>No account needed to play as a guest.</Text>
            {!!notice && <View style={styles.notice} accessibilityLiveRegion="polite">
              <Text style={styles.noticeText}>{notice}</Text>
              <Pressable accessibilityRole="button" accessibilityLabel="Dismiss message" onPress={() => setNotice('')} style={styles.dismiss}>
                <Text style={styles.dismissText}>Dismiss</Text>
              </Pressable>
            </View>}
            <View style={[styles.footer, wide && styles.wideFooter]}>
              <Pressable accessibilityRole="button" onPress={() => setNotice('Terms will be available before account sign-in launches.')} style={styles.footerButton}><Text style={styles.footerText}>Terms</Text></Pressable>
              <Text style={styles.footerSeparator}>|</Text>
              <Pressable accessibilityRole="button" onPress={() => setNotice('The privacy policy will be available before account sign-in launches.')} style={styles.footerButton}><Text style={styles.footerText}>Privacy</Text></Pressable>
            </View>
          </View>
        </View>
      </ScrollView>
    </LinearGradient>
  );
}
const createStyles = (colors: ThemeColors) => StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background, overflow: 'hidden' },
  halo: { position: 'absolute', width: 760, height: 760, borderRadius: 380,
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceRaised, top: -360, left: -250 },
  scroll: { flexGrow: 1, justifyContent: 'center', alignItems: 'center' },
  layout: { width: '100%', maxWidth: 480, alignItems: 'center' },
  wideLayout: { maxWidth: 1160, flexDirection: 'row', alignItems: 'stretch', gap: 48 },
  brandSide: { alignItems: 'center', width: '100%' },
  wideBrand: { flex: 1, width: 'auto', justifyContent: 'center', paddingVertical: 32 },
  mobileIntro: { alignItems: 'center', marginTop: 13, gap: 6 },
  mobileHeading: { fontFamily: fonts.display, fontSize: 31, color: colors.text },
  mobileSubtitle: { fontFamily: fonts.body, fontSize: 14, color: colors.textMuted },
  panel: { backgroundColor: colors.surface, borderRadius: 22, boxShadow: '0px 18px 60px rgba(0, 0, 0, 0.2)' },
  widePanel: { width: 480, paddingHorizontal: 44, paddingTop: 48, paddingBottom: 24, justifyContent: 'center', minHeight: 660 },
  mobilePanel: { marginTop: 22, width: '100%', padding: 22, borderRadius: 20 },
  intro: { alignItems: 'center', marginBottom: 48 },
  heading: { fontFamily: fonts.display, fontSize: 52, color: colors.text, letterSpacing: -1.5, textAlign: 'center' },
  subtitle: { fontFamily: fonts.body, fontSize: 19, color: colors.textMuted, marginTop: 8, textAlign: 'center' },
  buttons: { gap: 13 },
  divider: { flexDirection: 'row', alignItems: 'center', gap: 20, marginVertical: 25 },
  dividerLine: { flex: 1, height: 1, backgroundColor: colors.border },
  or: { fontFamily: fonts.body, fontSize: 14, color: colors.textMuted },
  helper: { fontFamily: fonts.body, fontSize: 11, lineHeight: 18, color: colors.textMuted, textAlign: 'center', marginTop: 14 },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 23 },
  wideFooter: { marginTop: 50 },
  footerButton: { minHeight: 44, minWidth: 60, alignItems: 'center', justifyContent: 'center' },
  footerText: { fontFamily: fonts.body, fontSize: 12, color: colors.textMuted },
  footerSeparator: { color: colors.textMuted, fontSize: 12 },
  notice: { backgroundColor: colors.surface, borderRadius: 10, padding: 14, marginTop: 18 },
  noticeText: { fontFamily: fonts.body, fontSize: 12, lineHeight: 19, color: colors.text },
  dismiss: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
  dismissText: { fontFamily: fonts.medium, fontSize: 12, color: colors.accent },
});
