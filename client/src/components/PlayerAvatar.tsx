import { ui } from '../i18n/copy.ts';
import { useUiLanguage } from '../i18n/useUiLanguage';
import { useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { Image, View } from 'react-native';

export function PlayerAvatar({ uri }: { uri?: string }) {
  useUiLanguage();
  const [failed, setFailed] = useState<string>();
  return <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: '#E5E5E5', borderWidth: 1, borderColor: '#A3A3A3', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
    {uri && failed !== uri ? <Image accessibilityLabel={ui("common.player_photo")} source={{ uri }} onError={() => setFailed(uri)} style={{ width: 32, height: 32, borderRadius: 16 }} />
      : <Ionicons accessibilityLabel={ui("common.anonymous_profile")} name="person" size={24} color="#737373" />}
  </View>;
}

