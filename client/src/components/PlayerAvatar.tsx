import {avatarSource} from '../multiplayer/presetAvatars';
import { useTheme } from '../theme';
import { ui } from '../i18n/copy.ts';
import { useUiLanguage } from '../i18n/useUiLanguage';
import { useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { Image, View } from 'react-native';

export function PlayerAvatar({ uri, size = 34 }: { uri?: string; size?: number }) {
  useUiLanguage();
  const { colors: c } = useTheme();
  const [failed, setFailed] = useState<string>();
  const source=avatarSource(uri);
  return <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: c.surfaceRaised, borderWidth: 1, borderColor: c.borderSubtle, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
    {source && uri && failed !== uri ? <Image accessibilityLabel={ui("common.player_photo")} testID="player-avatar-image" source={source} onError={() => setFailed(uri)} style={{ width: size - 2, height: size - 2, borderRadius: (size - 2) / 2 }} />
      : <Ionicons accessibilityLabel={ui("common.anonymous_profile")} name="person" size={size * 0.7} color={c.textMuted} />}
  </View>;
}

