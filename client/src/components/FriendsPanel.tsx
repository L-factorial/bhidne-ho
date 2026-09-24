import { ui, uiLabel } from '../i18n/copy.ts';
import { useUiLanguage } from '../i18n/useUiLanguage';
import { gameControlFinish, gameHeadingFinish, gamePanelFinish, fonts, useTheme, useThemedStyles, type ThemeColors } from '../theme';
import { FormInput } from './FormInput';
import { RoomSheet } from './RoomSheet';
import { ChatComposer } from './ChatComposer';
import { FormFooter } from './FormFooter';
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { request } from '../multiplayer/api';
import type { Session } from '../multiplayer/session';

type Player = { user_id: string; display_name: string; username?: string | null };
type Snapshot = { friends: Player[]; incoming: Player[]; outgoing: Player[] };
type Message = { id: string; sender_id: string; recipient_id: string; text: string; sent_at: number };
const empty: Snapshot = { friends: [], incoming: [], outgoing: [] };
const label = (player: Player) => player.display_name || player.username || ui("common.player");

export function FriendsPanel({ session }: { session: Session }) {
  useUiLanguage();
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const [snapshot, setSnapshot] = useState<Snapshot>(empty);
  const [query, setQuery] = useState(''), [results, setResults] = useState<Player[]>([]);
  const [selected, setSelected] = useState<Player | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const draft = selected ? drafts[selected.user_id] || '' : '';
  const selectedId = useRef<string | null>(null); selectedId.current = selected?.user_id ?? null;
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const sending = useRef(false);
  const [sendError, setSendError] = useState('');

  async function refresh(signal?: AbortSignal) {
    const value = await request<Snapshot>('/friends', session, undefined, signal);
    if (!signal?.aborted) {
      setSnapshot(value);
      if (selected && !value.friends.some(friend => friend.user_id === selected.user_id)) setSelected(null);
    }
  }
  useEffect(() => {
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try { await refresh(controller.signal); if (!controller.signal.aborted) setError(''); }
      catch (failure) { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : ui("feedback.could_not_load_friends")); }
      finally { if (!controller.signal.aborted) timer = setTimeout(poll, 3000); }
    }
    void poll(); return () => { controller.abort(); clearTimeout(timer); };
  }, [session.token]);
  useEffect(() => {
    if (!selected) { setMessages([]); return; }
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const value = await request<Message[]>(`/friends/${encodeURIComponent(selected!.user_id)}/messages`, session, undefined, controller.signal);
        if (!controller.signal.aborted) { setMessages(value); setError(''); }
      } catch (failure) { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : ui("feedback.could_not_load_messages")); }
      finally { if (!controller.signal.aborted) timer = setTimeout(poll, 1500); }
    }
    void poll(); return () => { controller.abort(); clearTimeout(timer); };
  }, [selected?.user_id, session.token]);

  async function search() {
    if (query.trim().length < 2 || busy) return;
    setBusy(true); setError('');
    try { setResults(await request<Player[]>(`/players/search?q=${encodeURIComponent(query.trim())}`, session)); }
    catch (failure) { setError(failure instanceof Error ? failure.message : ui("feedback.could_not_search_players")); }
    finally { setBusy(false); }
  }
  async function mutate(path: string, method?: 'DELETE') {
    if (busy) return;
    setBusy(true); setError('');
    try { await request(path, session, method ? undefined : {}, undefined, method); await refresh(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : ui("feedback.could_not_update_friendship")); }
    finally { setBusy(false); }
  }
  async function send() {
    if (!selected || sending.current || !draft.trim() || Array.from(draft).length > 500) return;
    const recipientId = selected.user_id, submitted = draft;
    sending.current = true; setBusy(true); setSendError('');
    try {
      const message = await request<Message>(`/friends/${encodeURIComponent(recipientId)}/messages`, session, { text: submitted });
      if (selectedId.current === recipientId) setMessages(current => current.some(item => item.id === message.id) ? current : [...current, message]);
      setDrafts(current => current[recipientId] === submitted ? { ...current, [recipientId]: '' } : current);
    } catch (failure) { if (selectedId.current === recipientId) setSendError(failure instanceof Error ? failure.message : ui("feedback.could_not_send_message")); }
    finally { sending.current = false; setBusy(false); }
  }
  const related = new Set([...snapshot.friends, ...snapshot.incoming, ...snapshot.outgoing].map(player => player.user_id));
  const row = (player: Player, action: ReactNode) => <View key={player.user_id} style={styles.row}>
    <View style={{ flex: 1 }}><Text style={styles.name}>{label(player)}</Text>
      {!!player.username && <Text style={styles.detail}>@{player.username}</Text>}</View>{action}
  </View>;

  return <View style={styles.panel}>
    <View style={styles.row}><Text accessibilityRole="header" style={styles.title}>{ui("common.friends")}</Text></View>
    <Text style={styles.detail}>Find a player by username or display name, manage requests, and message your connections.</Text>
    <View style={styles.searchRow}>
      <FormInput accessibilityLabel={ui("social.find_players")} value={query} onChangeText={setQuery} maxLength={50}
        autoCapitalize="none" placeholder={ui("social.username_or_display_name")} placeholderTextColor={colors.textMuted}
        returnKeyType="search" onSubmitEditing={() => void search()} style={styles.input} />
      <Pressable accessibilityRole="button" disabled={busy || query.trim().length < 2} onPress={() => void search()} style={[styles.button, (busy || query.trim().length < 2) && styles.disabled]}><Text style={styles.buttonText}>{ui("common.search")}</Text></Pressable>
    </View>
    {results.map(player => row(player, related.has(player.user_id)
      ? <Text style={styles.detail}>{ui("social.already_connected")}</Text>
      : <Pressable accessibilityRole="button" onPress={() => void mutate(`/friends/requests/${encodeURIComponent(player.user_id)}`)} style={styles.smallButton}><Text style={styles.buttonText}>{ui("social.add_friend")}</Text></Pressable>))}

    {!!snapshot.incoming.length && <><Text style={styles.heading}>{ui("social.requests_received")}</Text>{snapshot.incoming.map(player => row(player, <View style={styles.actions}>
      <Pressable accessibilityRole="button" onPress={() => void mutate(`/friends/requests/${encodeURIComponent(player.user_id)}/accept`)} style={styles.smallButton}><Text style={styles.buttonText}>{ui("common.accept")}</Text></Pressable>
      <Pressable accessibilityRole="button" onPress={() => void mutate(`/friends/${encodeURIComponent(player.user_id)}`, "DELETE")} style={styles.linkButton}><Text style={styles.link}>{ui("common.decline")}</Text></Pressable>
    </View>))}</>}
    {!!snapshot.outgoing.length && <><Text style={styles.heading}>{ui("social.requests_sent")}</Text>{snapshot.outgoing.map(player => row(player,
      <Pressable accessibilityRole="button" onPress={() => void mutate(`/friends/${encodeURIComponent(player.user_id)}`, "DELETE")} style={styles.linkButton}><Text style={styles.link}>{ui("common.cancel")}</Text></Pressable>))}</>}
    <Text style={styles.heading}>{ui("social.your_friends")}</Text>
    {!snapshot.friends.length && <Text style={styles.detail}>{ui("social.no_friends_yet")}</Text>}
    {snapshot.friends.map(player => row(player, <View style={styles.actions}>
      <Pressable accessibilityRole="button" onPress={() => { setMessages([]); setError(''); setSendError(''); setSelected(player); }} style={styles.smallButton}><Text style={styles.buttonText}>{ui("social.message")}</Text></Pressable>
      <Pressable accessibilityRole="button" onPress={() => void mutate(`/friends/${encodeURIComponent(player.user_id)}`, "DELETE")} style={styles.linkButton}><Text style={styles.link}>{ui("common.remove")}</Text></Pressable>
    </View>))}

    {selected && <RoomSheet visible title={ui("social.chat_with_player", { "player": label(selected) })} closeLabel={ui("common.close_private_chat")} onClose={() => setSelected(null)} scrollable={false}
      footer={<FormFooter>
        {!!(sendError || error) && <Text accessibilityRole="alert" style={styles.error}>{sendError || error}</Text>}
        <ChatComposer value={draft} onChange={value => setDrafts(current => ({ ...current, [selected.user_id]: value }))}
          onSend={() => void send()} disabled={busy} placeholder={ui("social.write_a_private_message")} label={`Message ${label(selected)}`} sendLabel="Send privately" />
      </FormFooter>}>
      <ScrollView style={{ flex: 1, minHeight: 0 }} contentContainerStyle={{ padding: 20 }} keyboardShouldPersistTaps="handled" nestedScrollEnabled>
        {!messages.length && <Text style={styles.detail}>{ui("common.no_messages_yet")}</Text>}
        {messages.map(message => <View key={message.id} style={[styles.message, message.sender_id === session.user_id && styles.mine]}>
          <Text style={styles.detail}>{message.sender_id === session.user_id ? ui("common.you") : label(selected)} · {new Date(message.sent_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</Text>
          <Text selectable style={styles.messageText}>{message.text}</Text>
        </View>)}
      </ScrollView>
    </RoomSheet>}
    {!!error && <Text accessibilityRole="alert" style={styles.error}>{uiLabel(error, 'feedback')}</Text>}
  </View>;
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  panel: { ...gamePanelFinish(colors), backgroundColor: colors.surface, padding: 20, borderRadius: 16, gap: 12 },
  title: { ...gameHeadingFinish(colors), fontFamily: fonts.display, fontSize: 25, color: colors.text }, heading: { ...gameHeadingFinish(colors), fontFamily: fonts.medium, fontSize: 14, color: colors.text },
  detail: { fontFamily: fonts.body, fontSize: 11, lineHeight: 18, color: colors.textMuted },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 8 }, row: { flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: 1, borderColor: colors.border, paddingVertical: 10 },
  name: { fontFamily: fonts.medium, fontSize: 13, color: colors.text }, actions: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  input: { flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 12, color: colors.text, backgroundColor: colors.background, fontFamily: fonts.body },
  button: { ...gameControlFinish(colors), minHeight: 44, paddingHorizontal: 16, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  smallButton: { minHeight: 40, paddingHorizontal: 10, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  linkButton: { minHeight: 40, paddingHorizontal: 8, justifyContent: 'center' }, buttonText: { fontFamily: fonts.medium, fontSize: 11, color: colors.text }, link: { fontFamily: fonts.medium, fontSize: 11, color: colors.accent }, disabled: { opacity: 0.5 },
  message: { alignSelf: 'flex-start', maxWidth: '85%', backgroundColor: colors.background, padding: 10, borderRadius: 10, marginVertical: 4 }, mine: { alignSelf: 'flex-end', backgroundColor: colors.surfaceSelected },
  messageText: { fontFamily: fonts.body, fontSize: 13, lineHeight: 19, color: colors.text }, error: { fontFamily: fonts.body, fontSize: 12, color: colors.danger },
});
