import { Image, View } from 'react-native';
import { branding } from './src/branding';
import { ThemeProvider } from './src/ThemeProvider';
import { useTheme } from './src/theme';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { useFonts } from 'expo-font';
import { Inter_400Regular } from '@expo-google-fonts/inter/400Regular';
import { Inter_500Medium } from '@expo-google-fonts/inter/500Medium';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { WelcomeScreen } from './src/screens/WelcomeScreen';
import { apiUrl } from './src/multiplayer/api';
import { readSession } from './src/multiplayer/session';
import { SharedRoomsScreen } from './src/screens/SharedRoomsScreen';

export default function App() { return <ThemeProvider><AppContent /></ThemeProvider>; }

function AppContent() {
  const { mode, colors } = useTheme();
  const [inRooms, setInRooms] = useState(() => !!readSession(apiUrl));
  const [loaded, error] = useFonts({ Inter_400Regular, Inter_500Medium });
  if (!loaded && !error) return <View style={{ flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' }}>
    <Image source={branding.icon} accessibilityLabel="Loading Bhidne Ho" resizeMode="contain" style={{ width: 160, height: 160, borderRadius: 24 }} />
  </View>;
  return (
    <SafeAreaProvider>
      <StatusBar style={mode === 'dark' ? 'light' : 'dark'} />
      {inRooms ? <SharedRoomsScreen onExit={() => setInRooms(false)} />
        : <WelcomeScreen onEnterLobby={() => setInRooms(true)} />}
    </SafeAreaProvider>
  );
}
