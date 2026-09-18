import { readInvitation, type Invitation } from './src/multiplayer/invitations';
import { Image, Linking, Platform, View } from 'react-native';
import { branding } from './src/branding';
import { ThemeProvider } from './src/ThemeProvider';
import { useTheme } from './src/theme';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { useFonts } from 'expo-font';
import { Inter_400Regular } from '@expo-google-fonts/inter/400Regular';
import { Inter_500Medium } from '@expo-google-fonts/inter/500Medium';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { WelcomeScreen } from './src/screens/WelcomeScreen';
import { apiUrl } from './src/multiplayer/api';
import { readSession } from './src/multiplayer/session';
import { SharedRoomsScreen } from './src/screens/SharedRoomsScreen';
import { LanguageProvider } from './src/i18n/LanguageProvider';
import { useTranslation } from 'react-i18next';

export default function App() { return <LanguageProvider><ThemeProvider><AppContent /></ThemeProvider></LanguageProvider>; }

function AppContent() {
  const { t } = useTranslation();
  const { mode, colors } = useTheme();
  const [invitation, setInvitation] = useState<Invitation | null>(() => Platform.OS === 'web' ? readInvitation(globalThis.location.href) : null);
  const [inRooms, setInRooms] = useState(() => !!readSession(apiUrl) || !!invitation);
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
  const [loaded, error] = useFonts({ Inter_400Regular, Inter_500Medium });
  if (!loaded && !error) return <View style={{ flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' }}>
    <Image source={branding.icon} accessibilityLabel={t('common.loading')} resizeMode="contain" style={{ width: 160, height: 160, borderRadius: 24 }} />
  </View>;
  return (
    <SafeAreaProvider>
      <StatusBar style={mode === 'dark' ? 'light' : 'dark'} />
      {inRooms || invitation ? <SharedRoomsScreen invitation={invitation} dismissInvitation={dismissInvitation} onExit={() => { dismissInvitation(); setInRooms(false); }} />
        : <WelcomeScreen onEnterLobby={() => setInRooms(true)} />}
    </SafeAreaProvider>
  );
}
