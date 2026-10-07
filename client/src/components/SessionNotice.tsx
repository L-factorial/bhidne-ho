import {AppText as Text} from './AppText';
import { retrySessionStorage } from '../multiplayer/session';
import { useSyncExternalStore } from 'react';
import {Pressable, View} from 'react-native';
import { sessionNotice, subscribeSessionNotice } from '../auth/sessionNotice';
import { apiUrl } from '../multiplayer/api';
import { ui } from '../i18n/copy';
import type { UiKey } from '../i18n/catalogs';
import { useUiLanguage } from '../i18n/useUiLanguage';
import { useTheme } from '../theme';
const snapshot = () => sessionNotice(apiUrl);
export function SessionNotice() {
  useUiLanguage();
  const { colors } = useTheme();
  const notices = useSyncExternalStore(subscribeSessionNotice, snapshot, snapshot);
  return <View>{notices.split(',').filter(Boolean).map(key => <Text key={key} accessibilityRole="alert"
    style={{padding:12,backgroundColor:colors.surface,color:colors.text}}>{ui(`common.${key}` as UiKey)}</Text>)}
    {(notices.includes('storage_save_failed') || notices.includes('storage_clear_failed')) && <Pressable
      accessibilityRole="button" onPress={() => retrySessionStorage(apiUrl)} style={{padding:12,minHeight:44}}>
      <Text style={{color:colors.text}}>{ui('common.retry')}</Text>
    </Pressable>}
  </View>;
}
