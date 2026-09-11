import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { useFonts } from 'expo-font';
import { CormorantGaramond_600SemiBold } from '@expo-google-fonts/cormorant-garamond/600SemiBold';
import { Inter_400Regular } from '@expo-google-fonts/inter/400Regular';
import { Inter_500Medium } from '@expo-google-fonts/inter/500Medium';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { WelcomeScreen } from './src/screens/WelcomeScreen';
import { SharedRoomsScreen } from './src/screens/SharedRoomsScreen';

export default function App() {
  const [inRooms, setInRooms] = useState(false);
  const [loaded, error] = useFonts({ CormorantGaramond_600SemiBold, Inter_400Regular, Inter_500Medium });
  if (!loaded && !error) return null;
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      {inRooms ? <SharedRoomsScreen onExit={() => setInRooms(false)} />
        : <WelcomeScreen onEnterLobby={() => setInRooms(true)} />}
    </SafeAreaProvider>
  );
}
