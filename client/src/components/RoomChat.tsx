import {useOutgoingChat} from './useOutgoingChat';
import {runtimeRequest} from '../multiplayer/RuntimeRequests';
import {useChatScroll} from './useChatScroll';
import {useFreshSoundEvents} from '../notifications/useFreshSoundEvents';
import {AppText as Text} from './AppText';
import { preserveRemovals } from './moderation/messages';
import { CommunityRulesEntry, useCommunityRulesGate } from './moderation/CommunityRules';
import { ReportButton } from './Moderation';
import { useBlocking } from './PlayerBlocking';
import { usePersistentNotice } from '../multiplayer/usePersistentNotice';
import { retryingError, playerError } from '../multiplayer/playerError.ts';
import { ui } from '../i18n/copy.ts';
import { Ionicons } from '@expo/vector-icons';
import { ChatMessage } from './ChatMessage';
import { RoomSheet } from './RoomSheet';
import { RoomChatPeople } from './RoomChatPeople';
import { ChatComposer } from './ChatComposer';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import {Keyboard, Pressable, ScrollView, StyleSheet, View} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePong } from '../notifications/usePong';
import { ApiError, request } from '../multiplayer/api';
import type { Session } from '../multiplayer/session';
import { fonts, useTheme, useThemedStyles, type ThemeColors } from '../theme';
import { useTranslation } from 'react-i18next';
import { observeRuntimeChat } from '../multiplayer/RuntimeRequests';

type Message = { id: string; sender_id: string; sender_avatar_url?: string | null; sender_name: string; text: string; removed?: boolean; sent_at: number };

export function useRoomChat({ roomId, session, connected, onlineIds, hideWhenBlocked = false, expanded, onExpandedChange, renderLauncher, bottomOffset = 0, launcherVisible = true }: { onlineIds?: string[]; launcherVisible?: boolean; expanded?: boolean; onExpandedChange?: (open: boolean) => void; renderLauncher?: (state: { open: boolean; unread: number; blocked: boolean; toggle: () => void }) => ReactNode; bottomOffset?: number; hideWhenBlocked?: boolean; roomId: string; session: Session; connected: boolean }) {
  const blocking = useBlocking(session);
  const rules = useCommunityRulesGate(session);
  const { colors } = useTheme();
  const { t } = useTranslation();
  const styles = useThemedStyles(createStyles);
  const [localOpen, setLocalOpen] = useState(false);
  const open = expanded ?? localOpen;
  const setOpen = (value: boolean) => { if (!value) Keyboard.dismiss(); setLocalOpen(value); onExpandedChange?.(value); };
  useEffect(() => { if (!open) Keyboard.dismiss(); }, [open]);
  const [blocked, setBlocked] = useState(false);
  const [unread, setUnread] = useState(0);
  const [muted, setMuted] = useState(false);
  const insets = useSafeAreaInsets();

  const { play, prepare } = usePong();
  const freshSounds=useFreshSoundEvents(`${session.token}:${roomId}`);
  const notification = useRef({ open, muted, play });
  notification.current = { open, muted, play };
  const previousIds = useRef<Set<string> | null>(null);
  function openChat() { prepare(); void rules.run(()=>{setUnread(0); chatScroll.showLatest(); setOpen(true);}); }

  const [messages, setMessages] = useState<Message[]>([]);
  const outgoing=useOutgoingChat<Message>(session.token);
  const visibleMessages=outgoing.rows(roomId,messages);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');
  const showLoadError = usePersistentNotice(!!loadError);
  const reconnecting = usePersistentNotice(!connected && !!roomId);
  const visibleError = error || (showLoadError ? loadError : '');
  const busy=outgoing.blocked;
  const chatScroll=useChatScroll(`${session.token}:${roomId}`,visibleMessages.at(-1),session.user_id);
  const path = `/rooms/${encodeURIComponent(roomId)}/chat`;
  const length = Array.from(draft).length;
  useEffect(() => { setOpen(false); setMessages([]); setDraft(''); setUnread(0); setBlocked(false); previousIds.current = null; }, [roomId, session.token]);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let pushGeneration=0;
    const install=(history:Message[])=>{
      if(controller.signal.aborted)return;
      const soundIds=freshSounds(history.map(m=>m.id));
      const fresh=previousIds.current?history.filter(m=>!previousIds.current!.has(m.id)&&m.sender_id!==session.user_id):[];
      previousIds.current=new Set(history.map(m=>m.id));
      if(fresh.length&&!notification.current.open){setUnread(n=>n+fresh.length);if(!notification.current.muted&&fresh.some(m=>soundIds.includes(m.id)))notification.current.play();}
      setMessages(current=>preserveRemovals(current,history));setLoadError('');setBlocked(false);
    };
    const unsubscribe=observeRuntimeChat(session,path,rows=>{
      pushGeneration++;
      install(rows);clearTimeout(timer);timer=setTimeout(refresh,30000);
    });
    async function refresh() {
      const generation=pushGeneration;
      try {
        const history = await request<Message[]>(path, session, undefined, controller.signal);
        if (!controller.signal.aborted && generation===pushGeneration) {
          install(history);
        }
      } catch (failure) {
        if (!controller.signal.aborted) {
          const paused = failure instanceof ApiError && failure.status === 403 && failure.message.startsWith('Chat is paused');
          setBlocked(paused);
          if (paused) { setOpen(false); setMessages([]); setUnread(0); previousIds.current = null; }
          setLoadError(retryingError(failure, ui("feedback.could_not_load_chat")));
        }
      } finally {
        if (!controller.signal.aborted){clearTimeout(timer);timer = setTimeout(refresh, unsubscribe?30000:1000);}
      }
    }
    if (connected) void refresh();
    return () => { controller.abort(); clearTimeout(timer);unsubscribe?.(); };
  }, [path, session.token, connected, blocking.revision]);
  async function send() {
    if (busy || blocked || !connected || !draft.trim() || length > 500) return;
    const submitted=draft;
    let durable=false;
    try{durable=!!runtimeRequest(session);}catch(failure){setError(playerError(failure,ui('feedback.could_not_send_message')));return;}
    const accepted=outgoing.send(roomId,{sender_id:session.user_id,sender_name:ui('common.you'),text:submitted},
      (id,text)=>request<Message>(path,session,{text,...(durable?{client_message_id:id}:{})}),durable);
    if(accepted){setDraft('');setError('');chatScroll.showLatest();}
  }
  if (blocked && hideWhenBlocked) return { view: null, navigation: null };
  const launcher = renderLauncher?.({ open, unread, blocked, toggle: () => { if (open) setOpen(false); else if (!blocked) openChat(); } });
  return { navigation: launcher, view: <>{rules.view}{!open && launcherVisible && launcher}
    {!renderLauncher && <Pressable onPress={openChat} accessibilityRole="button" accessibilityLabel={t('chat.title')} style={[styles.dock, { bottom: bottomOffset + insets.bottom, right: 12, padding: 16, backgroundColor: colors.surface }]}><Text style={styles.heading}>{t('chat.title')}{unread ? ` · ${unread}` : ''}</Text></Pressable>}
    {open && !blocked && <RoomSheet visible title={t('chat.title')} onClose={() => setOpen(false)} scrollable={false}
      headerActions={<Pressable accessibilityRole="button" accessibilityLabel={t(muted ? 'chat.soundOff' : 'chat.soundOn')} accessibilityState={{ selected: !muted }} onPress={() => { prepare(); setMuted(value => !value); }} style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}><Ionicons name={muted ? 'volume-mute-outline' : 'volume-high-outline'} size={20} color={colors.textMuted} /></Pressable>}
      footer={renderLauncher ? <View style={{ height: 64 + Math.max(8, insets.bottom) }}>{launcher}</View> : undefined}>
      <View testID="room-chat-window" style={[styles.chatBody, { flex: 1, minHeight: 0 }]}><RoomChatPeople roomId={roomId} session={session} onlineIds={connected?onlineIds:undefined}/>

        <ScrollView ref={chatScroll.scroll} testID="room-chat-history" keyboardShouldPersistTaps="always" style={{ flex: 1, minHeight: 0 }} scrollEventThrottle={16}
          onScroll={chatScroll.onScroll} onLayout={chatScroll.followLayout}
          onContentSizeChange={chatScroll.followLayout}>
          {!visibleMessages.length && <View style={{ paddingVertical: 32, gap: 8, alignItems: 'center' }}><Ionicons name="chatbubbles-outline" size={30} color={colors.textMuted} /><Text style={styles.heading}>{ui("social.no_messages_yet")}</Text><Text style={styles.note}>{ui("social.say_something_to_get_the_table_going")}</Text></View>}
          {visibleMessages.map(message => <ChatMessage delivery={message.delivery} sendError={message.send_error} onRetry={message.can_retry?()=>outgoing.retry(message.retry_id!):undefined} tableStyle key={message.id} message={message} own={message.sender_id === session.user_id} action={<ReportButton menu session={session} enabled={blocking.reporting} scope="chat" messageId={message.id} player={{user_id: message.sender_id, display_name: message.sender_name}} />} />)}
        </ScrollView>
        {reconnecting && <Text style={styles.note}>{t('chat.reconnecting')}</Text>}
        {!!visibleError && <Text activity accessibilityRole="alert" style={styles.error}>{visibleError}</Text>}
        <CommunityRulesEntry session={session} />
        <ChatComposer onComposeActivity={chatScroll.showLatest} value={draft} onChange={setDraft} onSend={() => void send()} disabled={busy || !connected} label={t('chat.title')} placeholder={t('chat.placeholder')} />
      </View>
    </RoomSheet>}
  </> };
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  dock: { position: 'absolute', zIndex: 50, elevation: 12 },
  chatBody: { gap: 8, overflow: 'hidden', padding: 12, borderTopWidth: 1, borderColor: colors.border },
  heading: { fontFamily: fonts.medium, fontSize: 14, color: colors.text },
  message: { paddingVertical: 12, gap: 6 },
  author: { fontFamily: fonts.medium, fontSize: 11, color: colors.accent },
  text: { fontFamily: fonts.body, fontSize: 13, lineHeight: 20, color: colors.text },
  note: { fontFamily: fonts.body, fontSize: 11, color: colors.textMuted },
  error: { color: colors.danger, fontFamily: fonts.body, fontSize: 12 },
});
