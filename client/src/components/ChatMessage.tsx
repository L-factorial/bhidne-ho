import {PlayerAvatar} from './PlayerAvatar';
import {AppText as Text} from './AppText';
import type { ReactNode } from 'react';
import {View,Text as NativeText} from 'react-native';
import { useTranslation } from 'react-i18next';
import { radii, fonts, useTheme } from '../theme';
import { localChatTime } from '../chatDates';

export function ChatMessage({ message, own, tableStyle = false, privateChat = false, action }: {
  action?: ReactNode; tableStyle?: boolean; privateChat?: boolean; message: { sender_avatar_url?: string | null; sender_name: string; text: string; removed?: boolean; sent_at: number }; own: boolean;
}) {
  const { colors: c } = useTheme();
  const { t } = useTranslation();
  return <View style={{ paddingVertical: 6, gap: 4, ...(tableStyle ? { backgroundColor: own ? c.ownMessage : c.surfaceRaised, borderRadius: radii.medium, paddingHorizontal: 10, marginBottom: 8 } : {}),
    ...(privateChat ? { alignSelf: own ? 'flex-end' : 'flex-start', width: '90%', backgroundColor: own ? c.surfaceSelected : c.surface,
      borderWidth: 1, borderColor: own ? c.border : c.borderSubtle } : {}) }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <PlayerAvatar size={28} uri={message.sender_avatar_url||undefined}/>
      <Text style={{ flex: 1, color: c.accent, fontFamily: fonts.medium, fontSize: 11 }}>{message.sender_name}{own && message.sender_name !== t('chat.you') ? ` (${t('chat.you')})` : ''}</Text>
      {!own && !message.removed && action}
    </View>
    <Text selectable style={{ marginLeft: 36, color: c.text, fontFamily: fonts.body, fontSize: 13, lineHeight: 20 }}>{message.removed ? t('moderation.removed') : message.text}</Text>
    <NativeText testID="chat-message-time" accessibilityLabel={new Date(message.sent_at).toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'long' })}
      style={{ alignSelf: 'flex-end', color: privateChat ? c.text : c.textMuted, fontFamily: privateChat ? fonts.medium : fonts.body, fontSize: privateChat ? 12 : 10, lineHeight: privateChat ? 18 : 14 }}>
      {privateChat ? localChatTime(message.sent_at) : new Date(message.sent_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
    </NativeText>
  </View>;
}
