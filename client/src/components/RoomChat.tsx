import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePong } from '../notifications/usePong';
import { ApiError, request } from '../multiplayer/api';
import type { Session } from '../multiplayer/session';
import { fonts, useTheme, useThemedStyles, type ThemeColors } from '../theme';

type Message = { id: string; sender_id: string; sender_name: string; text: string; sent_at: number };

export function RoomChat({ roomId, session, connected }: { roomId: string; session: Session; connected: boolean }) {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const [open, setOpen] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [unread, setUnread] = useState(0);
  const [muted, setMuted] = useState(false);
  const insets = useSafeAreaInsets();
  const { height: screenHeight } = useWindowDimensions();
  const card = useRef<View>(null);
  const [panelHeight, setPanelHeight] = useState(320);
  const followLatest = useRef(true);
  function fitChat() {
    card.current?.measureInWindow((_x, y) => {
      setPanelHeight(Math.max(260, screenHeight - Math.max(0, y) - Math.max(insets.bottom, 20) - 100));
    });
  }
  useEffect(() => { if (open) fitChat(); }, [screenHeight, insets.bottom, open]);
  const { play, prepare } = usePong();
  const notification = useRef({ open, muted, play });
  notification.current = { open, muted, play };
  const previousIds = useRef<Set<string> | null>(null);
  function openChat() { prepare(); setUnread(0); followLatest.current = true; fitChat(); setOpen(true); }

  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);
  const lifetime = useRef<AbortController | null>(null);
  const scroll = useRef<ScrollView>(null);
  const path = `/rooms/${encodeURIComponent(roomId)}/chat`;
  const length = Array.from(draft).length;
  useEffect(() => {
    const controller = new AbortController(); lifetime.current = controller;
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const history = await request<Message[]>(path, session, undefined, controller.signal);
        if (!controller.signal.aborted) {
          const fresh = previousIds.current ? history.filter(message => !previousIds.current!.has(message.id) && message.sender_id !== session.user_id) : [];
          previousIds.current = new Set(history.map(message => message.id));
          if (fresh.length && !notification.current.open) {
            setUnread(count => count + fresh.length);
            if (!notification.current.muted) notification.current.play();
          }
          setMessages(history); setLoadError(''); setBlocked(false);
        }
      } catch (failure) {
        if (!controller.signal.aborted) {
          const paused = failure instanceof ApiError && failure.status === 403 && failure.message.startsWith('Chat is paused');
          setBlocked(paused);
          if (paused) { setOpen(false); setMessages([]); setUnread(0); previousIds.current = null; }
          setLoadError(failure instanceof Error ? failure.message : 'Could not load chat.');
        }
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(refresh, 1000);
      }
    }
    if (connected) void refresh();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [path, session.token, connected]);
  async function send() {
    if (sending.current || blocked || !connected || !draft.trim() || length > 500) return;
    const signal = lifetime.current?.signal;
    sending.current = true; setBusy(true); setError('');
    try {
      await request<Message>(path, session, { text: draft }, signal);
      if (!signal?.aborted) setDraft('');
    } catch (failure) {
      if (!signal?.aborted) setError(failure instanceof Error ? failure.message : 'Could not send message.');
    } finally { sending.current = false; setBusy(false); }
  }
  return <View ref={card} style={[styles.card, unread > 0 && { borderWidth: 2, borderColor: colors.accent }]}>
    <Pressable accessibilityRole="button" accessibilityLabel="Room chat" aria-expanded={open} accessibilityState={{ expanded: open }} disabled={blocked} onPress={() => { if (open) setOpen(false); else openChat(); }} style={styles.toggle}>
      <Text style={styles.heading}>Room chat</Text><Text style={styles.heading}>{open ? '-' : unread ? `${unread} new` : '+'}</Text>
    </Pressable>
    {blocked && <Text style={styles.note}>Chat is paused while you are playing.</Text>}
    {!blocked && unread > 0 && <Text accessibilityLiveRegion="polite" style={styles.note}>New room banter! Tap to open chat.</Text>}
    {open && !blocked && <KeyboardAvoidingView testID="room-chat-window" style={[styles.chatBody, { height: panelHeight }]} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Pressable accessibilityRole="button" accessibilityLabel={muted ? 'Unmute chat notifications' : 'Mute chat notifications'} onPress={() => { prepare(); setMuted(value => !value); }}><Text style={styles.note}>{muted ? 'Chat sound off' : 'Chat sound on'}</Text></Pressable>
      <ScrollView ref={scroll} testID="room-chat-history" nestedScrollEnabled style={{ flex: 1, minHeight: 0 }} scrollEventThrottle={16}
        onScroll={({ nativeEvent: { contentOffset, contentSize, layoutMeasurement } }) => { followLatest.current = contentSize.height - contentOffset.y - layoutMeasurement.height < 40; }}
        onContentSizeChange={() => { if (followLatest.current) scroll.current?.scrollToEnd({ animated: false }); }}>
        {!messages.length && <Text style={styles.note}>Drop a goofy line. Challenge your friends. Get the game going!</Text>}
        {messages.map(message => <View key={message.id} style={styles.message}>
          <Text style={styles.author}>{message.sender_id === session.user_id ? 'You' : message.sender_name} ? {new Date(message.sent_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</Text>
          <Text selectable style={styles.text}>{message.text}</Text>
        </View>)}
      </ScrollView>
      {!connected && <Text style={styles.note}>Reconnecting to room...</Text>}
      {!!(error || loadError) && <Text accessibilityRole="alert" style={styles.error}>{error || loadError}</Text>}
      <TextInput accessibilityLabel="Room chat message" placeholder="Got a bold prediction or a punchline?" multiline value={draft} onChangeText={setDraft} editable={!busy} style={styles.input} />
      <Text style={styles.note}>{length}/500</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Send chat message" disabled={busy || !connected || !draft.trim() || length > 500} accessibilityState={{ disabled: busy || !connected || !draft.trim() || length > 500 }} onPress={() => void send()} style={[styles.send, (busy || !connected || !draft.trim() || length > 500) && { opacity: 0.5 }]}>
        <Text style={styles.sendText}>{busy ? 'Sending...' : 'Send'}</Text>
      </Pressable>
    </KeyboardAvoidingView>}
  </View>;
}
const createStyles = (colors: ThemeColors) => StyleSheet.create({
  chatBody: { gap: 12, overflow: 'hidden' },
  card: { backgroundColor: colors.surface, borderRadius: 16, padding: 24, gap: 8 },
  toggle: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  heading: { fontFamily: fonts.medium, fontSize: 14, color: colors.text },
  message: { paddingVertical: 10, borderBottomWidth: 1, borderColor: colors.border, gap: 5 },
  author: { fontFamily: fonts.medium, fontSize: 11, color: colors.accent },
  text: { fontFamily: fonts.body, fontSize: 13, lineHeight: 20, color: colors.text },
  note: { fontFamily: fonts.body, fontSize: 11, color: colors.textMuted },
  error: { color: colors.danger, fontFamily: fonts.body, fontSize: 12 },
  input: { height: 70, flexShrink: 0, borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 12, backgroundColor: colors.surface, color: colors.text, fontFamily: fonts.body },
  send: { minHeight: 44, flexShrink: 0, backgroundColor: colors.surfaceSelected, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  sendText: { color: colors.text, fontFamily: fonts.medium, fontSize: 12 },
});
