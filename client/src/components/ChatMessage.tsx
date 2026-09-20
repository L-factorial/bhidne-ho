import { Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { fonts, useTheme } from '../theme';

export function ChatMessage({ message, own }: {
  message: { sender_name: string; text: string; sent_at: number }; own: boolean;
}) {
  const { colors: c } = useTheme();
  const { t } = useTranslation();
  return <View style={{ paddingVertical: 12, gap: 6 }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: c.surfaceRaised, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ color: c.accent, fontFamily: fonts.medium, fontSize: 11 }}>{message.sender_name.slice(0, 1).toUpperCase()}</Text>
      </View>
      <Text style={{ flex: 1, color: c.accent, fontFamily: fonts.medium, fontSize: 11 }}>{message.sender_name}{own ? ` (${t('chat.you')})` : ''}</Text>
      <Text style={{ color: c.textMuted, fontFamily: fonts.body, fontSize: 11 }}>{new Date(message.sent_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</Text>
    </View>
    <Text selectable style={{ marginLeft: 36, color: c.text, fontFamily: fonts.body, fontSize: 13, lineHeight: 20 }}>{message.text}</Text>
  </View>;
}
