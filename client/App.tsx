import './src/auth/installStorage';
import { ui, uiLabel } from './src/i18n/copy';
import { readInvitation, type Invitation } from './src/multiplayer/invitations';
import { Image, Linking, Platform, Text, View } from 'react-native';
import { branding } from './src/branding';
import { ThemeProvider } from './src/ThemeProvider';
import { useTheme } from './src/theme';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { useFonts } from 'expo-font';
import { Inter_400Regular } from '@expo-google-fonts/inter/400Regular';
import { CormorantGaramond_700Bold } from '@expo-google-fonts/cormorant-garamond/700Bold';
import { Inter_500Medium } from '@expo-google-fonts/inter/500Medium';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { WelcomeScreen } from './src/screens/WelcomeScreen';
import { apiUrl } from './src/multiplayer/api';
import { readSession, saveSession } from './src/multiplayer/session';
import { completeSocialLogin, isSocialReturn } from './src/auth/social';
import { SharedRoomsScreen } from './src/screens/SharedRoomsScreen';
import { DistributedRoomsScreen } from './src/screens/DistributedRoomsScreen';
import { LanguageProvider } from './src/i18n/LanguageProvider';
import { useTranslation } from 'react-i18next';

export default function App() { return <LanguageProvider><ThemeProvider><AppContent /></ThemeProvider></LanguageProvider>; }

function AppContent() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const [invitation, setInvitation] = useState<Invitation | null>(() => Platform.OS === 'web' ? readInvitation(globalThis.location.href) : null);
  const [inRooms, setInRooms] = useState(() => !!readSession(apiUrl) || !!invitation);
  const [authVersion, setAuthVersion] = useState(0);
  const [authError, setAuthError] = useState('');
  const [finishingSignIn, setFinishingSignIn] = useState(() => Platform.OS === 'web' && isSocialReturn(globalThis.location.href));
  useEffect(() => {
    let active = true;
    async function finish(url: string | null) {
      if (!url || !isSocialReturn(url)) return;
      setFinishingSignIn(true);
      try {
        const session = await completeSocialLogin(url);
        if (!active) return;
        saveSession(apiUrl, { session, room: null, game: null });
        if (Platform.OS === 'web') setInvitation(readInvitation(globalThis.location.href));
        setAuthVersion(value => value + 1); setInRooms(true); setAuthError('');
      } catch (failure) {
        if (active) {
          setAuthError(failure instanceof Error ? failure.message : 'Could not complete sign-in. Please try again.');
          if (Platform.OS === 'web') {
            const current = new URL(globalThis.location.href); current.searchParams.delete('social_attempt');
            current.searchParams.delete('social_code');
            globalThis.history.replaceState(null, '', current.href);
          }
        }
      } finally { if (active) setFinishingSignIn(false); }
    }
    if (Platform.OS === 'web') void finish(globalThis.location.href);
    else void Linking.getInitialURL().then(finish).catch(() => {});
    return () => { active = false; };
  }, []);
  useEffect(() => {
    const open = (url: string | null) => { const value = url && readInvitation(url); if (value) { setInvitation(value); setInRooms(true); } };
    if (Platform.OS !== 'web') void Linking.getInitialURL().then(open).catch(() => {});
    const subscription = Linking.addEventListener('url', event => open(event.url));
    return () => subscription.remove();
  }, []);
  function dismissInvitation() {
    setInvitation(null);
    if (Platform.OS === 'web') { const url = new URL(globalThis.location.href); url.searchParams.delete('room'); url.searchParams.delete('match'); globalThis.history.replaceState(null, '', url.toString()); }
  }
  const [loaded, error] = useFonts({ Inter_400Regular, Inter_500Medium, CormorantGaramond_700Bold });
  if (!loaded && !error) return <View style={{ flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' }}>
    <Image source={branding.icon} accessibilityLabel={t('common.loading')} resizeMode="contain" style={{ width: 160, height: 160, borderRadius: 24 }} />
  </View>;
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      {!!authError && <Text accessibilityRole="alert" style={{ padding: 16, color: colors.danger }}>{uiLabel(authError, 'feedback')}</Text>}
      {finishingSignIn ? <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: colors.text }}>{ui('common.completing_sign_in')}</Text></View>
        : process.env.EXPO_PUBLIC_RUNTIME_MODE === 'distributed-integration' ? <DistributedRoomsScreen key={authVersion} />
        : inRooms || invitation ? <SharedRoomsScreen key={authVersion} invitation={invitation} dismissInvitation={dismissInvitation} onExit={() => { dismissInvitation(); setInRooms(false); }} />
        : <WelcomeScreen onEnterLobby={() => setInRooms(true)} />}
    </SafeAreaProvider>
  );
}
