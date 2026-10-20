import {PlayerAvatar} from './PlayerAvatar';
import {AppText as Text} from './AppText';
import type {ReactNode} from 'react';
import {MessageSendingBorder} from './MessageSendingBorder';
import {Ionicons} from '@expo/vector-icons';
import {ui} from '../i18n/copy';
import type {Delivery} from '../multiplayer/outgoingChat';
import {Pressable,View,Text as NativeText} from 'react-native';
import { useTranslation } from 'react-i18next';
import { radii, fonts, useTheme } from '../theme';
import { localChatTime } from '../chatDates';

export function ChatMessage({ message, own, tableStyle = false, privateChat = false, action, delivery, onRetry, sendError }: {
  delivery?:Delivery;onRetry?:()=>void;sendError?:string;action?: ReactNode; tableStyle?: boolean; privateChat?: boolean; message: { sender_avatar_url?: string | null; sender_name: string; text: string; removed?: boolean; sent_at: number }; own: boolean;
}) {
  const { colors: c } = useTheme();
  const { t } = useTranslation();
  return <View testID={delivery?'outgoing-chat-message':undefined} style={{ position:'relative',paddingVertical: 4, flexDirection: 'row', alignItems: 'center', gap: 8, ...(tableStyle ? { backgroundColor: own ? c.ownMessage : c.surfaceRaised, borderRadius: radii.medium, paddingHorizontal: 10, marginBottom: 6 } : {}),
    ...(privateChat ? { alignSelf: own ? 'flex-end' : 'flex-start', width: '90%', backgroundColor: own ? c.surfaceSelected : c.surface,
      borderWidth: 1, borderColor: own ? c.border : c.borderSubtle } : {}) }}>
    {(delivery==='sending'||delivery==='confirming')&&<MessageSendingBorder confirming={delivery==='confirming'}/>}
    <View testID="chat-sender" style={{ width: 60, alignItems: 'center', justifyContent: 'center', gap: 3, flexShrink: 0 }}>
      <PlayerAvatar size={24} uri={message.sender_avatar_url||undefined}/>
      <Text style={{ textAlign: 'center', width: '100%', color: c.accent, fontFamily: fonts.medium, fontSize: 11 }}>{message.sender_name}{own && message.sender_name !== t('chat.you') ? ` (${t('chat.you')})` : ''}</Text>
    </View>
    <View style={{flex:1,minWidth:0,gap:2}}>
    <View testID="chat-message-body" style={{flexDirection:'row',alignItems:'center',minHeight:own?44:undefined,gap:4}}>
    <Text selectable style={{ flex:1, color: c.text, fontFamily: fonts.body, fontSize: 13, lineHeight: 18 }}>{message.removed ? t('moderation.removed') : message.text}</Text>
    {own&&<View style={{width:44,height:44,justifyContent:'center'}}>{onRetry&&<Pressable testID="chat-retry" accessibilityRole="button" accessibilityLabel={ui('social.retry_message')} accessibilityHint={sendError} onPress={onRetry} style={{width:44,height:44,alignItems:'center',justifyContent:'center'}}><Ionicons name="refresh-outline" size={18} color={c.accent}/></Pressable>}</View>}
    </View>
    <View style={{flexDirection:'row',alignItems:'center',justifyContent:'flex-end',gap:8}}>
    <NativeText testID="chat-message-time" accessibilityLabel={new Date(message.sent_at).toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'long' })}
      style={{ alignSelf: 'flex-end', color: privateChat ? c.text : c.textMuted, fontFamily: privateChat ? fonts.medium : fonts.body, fontSize: 11, lineHeight: 16 }}>
      {privateChat ? localChatTime(message.sent_at) : new Date(message.sent_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
    </NativeText>
    </View>
    </View>
    {!own && !message.removed && action}

  </View>;
}
