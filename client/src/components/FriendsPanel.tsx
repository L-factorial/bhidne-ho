import {AppText as Text} from './AppText';
import { Ionicons } from '@expo/vector-icons';
import { PlayerAvatar } from './PlayerAvatar';
import { ContextMenu, MenuAction } from './ContextMenu';
import { ChatMessage } from './ChatMessage';
import { preserveRemovals } from './moderation/messages';
import { CommunityRulesEntry, useCommunityRulesGate } from './moderation/CommunityRules';
import { ReportButton } from './Moderation';
import { BlockPlayerButton, useBlocking } from './PlayerBlocking';
import { playerError } from '../multiplayer/playerError.ts';
import { ui, uiLabel } from '../i18n/copy.ts';
import { useUiLanguage } from '../i18n/useUiLanguage';
import { visualStates, radii, gameControlFinish, gamePanelFinish, typography, fonts, useTheme, useThemedStyles, type ThemeColors } from '../theme';
import { FormInput } from './FormInput';
import { RoomSheet } from './RoomSheet';
import { ChatComposer } from './ChatComposer';
import { FormFooter } from './FormFooter';
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {Pressable, ScrollView, StyleSheet, View} from 'react-native';
import { request } from '../multiplayer/api';
import type { Session } from '../multiplayer/session';

type Player = { user_id: string; display_name: string; username?: string | null; avatar_url?: string | null };
type Snapshot = { online_friend_ids?: string[] | null; friends: Player[]; incoming: Player[]; outgoing: Player[] };
export type Message = { id: string; sender_id: string; recipient_id: string; text: string; removed?: boolean; sent_at: number };
const empty: Snapshot = { friends: [], incoming: [], outgoing: [] };
const label = (player: Player) => player.display_name || player.username || ui("common.player");

export type FriendsTransport = {
  history(other: string, signal: AbortSignal): Promise<Message[]>;
  mutate(other: string, action: 'request-friend'|'accept-friend'|'remove-friend'): Promise<void>;
  send(other: string, text: string): Promise<void>; busy: boolean; error: string;
  sent?: {id:string;recipient:string;text:string};
};
export function FriendsPanel({ session, transport, onlineOnly = false, initialPlayerId, friendLimit }: { friendLimit?:number; initialPlayerId?:string; session: Session; transport?: FriendsTransport; onlineOnly?: boolean }) {
  useUiLanguage();
  const blocking = useBlocking(session);
  const rules = useCommunityRulesGate(session);
  const [expandedFriends,setExpandedFriends]=useState(false);
  useEffect(()=>setExpandedFriends(false),[session.token,onlineOnly]);
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const [snapshot, setSnapshot] = useState<Snapshot>(empty);
  const [query, setQuery] = useState(''), [results, setResults] = useState<Player[]>([]);
  const [selected, setSelected] = useState<Player | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const draft = selected ? drafts[selected.user_id] || '' : '';
  const selectedId = useRef<string | null>(null); selectedId.current = selected?.user_id ?? null;
  const [localBusy, setBusy] = useState(false), [localError, setError] = useState('');
  const busy=localBusy||!!transport?.busy, error=transport?.error||localError;
  const sending = useRef(false);
  const [sendError, setSendError] = useState('');
  useEffect(()=>{
    const sent=transport?.sent;
    if(sent)setDrafts(current=>current[sent.recipient]===sent.text?{...current,[sent.recipient]:''}:current);
  },[transport?.sent?.id]);

  useEffect(()=>{
    if(!initialPlayerId)return;
    const controller=new AbortController();
    void request<Snapshot>('/friends?include_presence=true',session,undefined,controller.signal).then(value=>{
      if(!controller.signal.aborted)void rules.run(()=>setSelected(value.friends.find(friend=>friend.user_id===initialPlayerId)??null));
    }).catch(failure=>{if(!controller.signal.aborted)setError(playerError(failure));});
    return()=>controller.abort();
  },[initialPlayerId,session.token]);
  async function refresh(signal?: AbortSignal) {
    const value = await request<Snapshot>('/friends?include_presence=true', session, undefined, signal);
    if (!signal?.aborted) {
      setSnapshot(value);
      setSelected(current => current && !value.friends.some(friend => friend.user_id === current.user_id) ? null : current);
    }
    return value;
  }
  useEffect(() => {
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try { await refresh(controller.signal); if (!controller.signal.aborted) setError(''); }
      catch (failure) { if (!controller.signal.aborted) { setSnapshot(current => ({...current, online_friend_ids: []})); setError(playerError(failure, ui("feedback.could_not_load_friends"))); } }
      finally { if (!controller.signal.aborted) timer = setTimeout(poll, 3000); }
    }
    void poll(); return () => { controller.abort(); clearTimeout(timer); };
  }, [session.token, onlineOnly, blocking.revision]);
  useEffect(() => {
    if (!selected) { setMessages([]); return; }
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const value = await (transport ? transport.history(selected!.user_id, controller.signal) : request<Message[]>(`/friends/${encodeURIComponent(selected!.user_id)}/messages`, session, undefined, controller.signal));
        if (!controller.signal.aborted) { setMessages(current=>preserveRemovals(current,value)); setError(''); }
      } catch (failure) { if (!controller.signal.aborted) setError(playerError(failure, ui("feedback.could_not_load_messages"))); }
      finally { if (!controller.signal.aborted) timer = setTimeout(poll, 1500); }
    }
    void poll(); return () => { controller.abort(); clearTimeout(timer); };
  }, [selected?.user_id, session.token, transport?.history]);

  async function search() {
    if (query.trim().length < 2 || busy) return;
    setBusy(true); setError('');
    try { setResults(await request<Player[]>(`/players/search?q=${encodeURIComponent(query.trim())}`, session)); }
    catch (failure) { setError(playerError(failure, ui("feedback.could_not_search_players"))); }
    finally { setBusy(false); }
  }
  async function mutate(other: string, action: 'request-friend'|'accept-friend'|'remove-friend') {
    const method = action === 'remove-friend' ? 'DELETE' : undefined;
    const path = method ? `/friends/${encodeURIComponent(other)}` : `/friends/requests/${encodeURIComponent(other)}${action === 'accept-friend' ? '/accept' : ''}`;
    if (busy) return;
    setBusy(true); setError('');
    try { if (transport) await transport.mutate(other, action); else await request(path, session, method ? undefined : {}, undefined, method); await refresh(); }
    catch (failure) { setError(playerError(failure, ui("feedback.could_not_update_friendship"))); }
    finally { setBusy(false); }
  }
  async function send() {
    if (!selected || busy || sending.current || !draft.trim() || Array.from(draft).length > 500) return;
    const recipientId = selected.user_id, submitted = draft;
    sending.current = true; setBusy(true); setSendError('');
    try {
      if (onlineOnly) {
        const latest = await refresh();
        if (!latest.online_friend_ids?.includes(recipientId) || !latest.friends.some(friend => friend.user_id === recipientId)) {
          setSendError(ui('social.friend_unavailable')); return;
        }
      }
      const message = transport ? (await transport.send(recipientId, submitted), null) : await request<Message>(`/friends/${encodeURIComponent(recipientId)}/messages`, session, { text: submitted });
      if (message && selectedId.current === recipientId) setMessages(current => current.some(item => item.id === message.id) ? current : [...current, message]);
      setDrafts(current => current[recipientId] === submitted ? { ...current, [recipientId]: '' } : current);
    } catch (failure) { if (selectedId.current === recipientId) setSendError(playerError(failure, ui("feedback.could_not_send_message"))); }
    finally { sending.current = false; setBusy(false); }
  }
  const available = !onlineOnly || !!selected && !!snapshot.online_friend_ids?.includes(selected.user_id);
  const visibleFriends = onlineOnly ? snapshot.friends.filter(player => snapshot.online_friend_ids?.includes(player.user_id)) : snapshot.friends;
  const related = new Set([...snapshot.friends, ...snapshot.incoming, ...snapshot.outgoing].map(player => player.user_id));
  const row = (player: Player, action: ReactNode) => <View key={player.user_id} style={styles.row}>
    <PlayerAvatar uri={player.avatar_url || undefined} />
    <View style={{ flex: 1, minWidth:60 }}><Text numberOfLines={1} style={styles.name}>{label(player)}</Text>
      {!!player.username && <Text style={styles.detail}>@{player.username}</Text>}
      {snapshot.online_friend_ids?.includes(player.user_id) && <View style={{flexDirection:'row',alignItems:'center',gap:5}}><View style={{width:7,height:7,borderRadius:4,backgroundColor:colors.success}}/><Text style={styles.detail}>{ui('common.online')}</Text></View>}
    </View>{action}
    {(blocking.reporting || blocking.enabled || snapshot.friends.some(f=>f.user_id===player.user_id)) && player.user_id!==session.user_id &&
      <ReportButton session={session} enabled={blocking.reporting} player={{user_id:player.user_id,display_name:label(player)}} renderTrigger={report=>
        <BlockPlayerButton session={session} enabled={blocking.enabled} player={{user_id:player.user_id,display_name:label(player)}} onBlocked={()=>{setResults(current=>current.filter(p=>p.user_id!==player.user_id));setSelected(null);setMessages([]);}} renderTrigger={block=>
          <ContextMenu label={`${ui('common.player_actions')} · ${label(player)}`}>{close=><>
            {blocking.reporting && <MenuAction label={`⚑ ${ui('moderation.report_player')}`} onPress={()=>{close();report();}}/>}
            {blocking.enabled && <MenuAction label={`⊘ ${ui('safety.confirm')}`} onPress={()=>{close();block();}}/>}
            {snapshot.friends.some(f=>f.user_id===player.user_id) && <View style={{borderTopWidth:1,borderColor:colors.border}}><MenuAction danger disabled={busy} label={ui('common.remove_friend')} onPress={()=>{close();void mutate(player.user_id,'remove-friend');}}/></View>}
          </>}</ContextMenu>}/>} />}

  </View>;

  return <View style={styles.panel}>
    <View style={{paddingVertical:8,borderBottomWidth:1,borderColor:colors.border}}><Text accessibilityRole="header" style={styles.title}>{onlineOnly ? ui("social.lobby_chat") : ui("common.friends")}</Text></View>
    <Text style={styles.detail}>{onlineOnly ? ui("social.online_chat_help") : ui("social.friends_help")}</Text>
    {!onlineOnly && <>
    <View style={styles.searchRow}>
      <View style={styles.searchField}><Ionicons name="search-outline" size={20} color={colors.textMuted}/><FormInput accessibilityLabel={ui("social.find_players")} value={query} onChangeText={setQuery} maxLength={50}
        autoCapitalize="none" placeholder={ui("social.username_or_display_name")} placeholderTextColor={colors.textMuted}
        returnKeyType="search" onSubmitEditing={() => void search()} style={styles.input} /></View>
      <Pressable accessibilityRole="button" disabled={busy || query.trim().length < 2} onPress={() => void search()} style={[styles.button, (busy || query.trim().length < 2) && styles.disabled]}><Text style={styles.buttonText}>{ui("common.search")}</Text></Pressable>
    </View>
    {!!results.length && <View style={styles.sectionHeading}><Text style={styles.heading}>{ui('common.search_results')}</Text><Text style={styles.count}>{results.length}</Text></View>}
    {results.map(player => row(player, related.has(player.user_id)
      ? <Text style={styles.detail}>{ui("social.already_connected")}</Text>
      : <Pressable accessibilityRole="button" accessibilityLabel={ui('social.add_friend')} disabled={busy} onPress={() => void mutate(player.user_id, 'request-friend')} style={styles.smallButton}><View style={{flexDirection:'row',alignItems:'center',gap:5}}><Ionicons name="person-add-outline" size={17} color={colors.accent}/><Text style={styles.link}>{ui("social.add_friend")}</Text></View></Pressable>))}

    {!!snapshot.incoming.length && <><Text style={styles.heading}>{ui("social.requests_received")}</Text>{snapshot.incoming.map(player => row(player, <View style={styles.actions}>
      <Pressable accessibilityRole="button" onPress={() => void mutate(player.user_id, 'accept-friend')} disabled={busy} style={styles.smallButton}><Text style={styles.link}>{ui("common.accept")}</Text></Pressable>
      <Pressable accessibilityRole="button" onPress={() => void mutate(player.user_id, 'remove-friend')} style={styles.linkButton}><Text style={styles.link}>{ui("common.decline")}</Text></Pressable>
    </View>))}</>}
    {!!snapshot.outgoing.length && <><Text style={styles.heading}>{ui("social.requests_sent")}</Text>{snapshot.outgoing.map(player => row(player,
      <Pressable accessibilityRole="button" onPress={() => void mutate(player.user_id, 'remove-friend')} style={styles.linkButton}><Text style={styles.link}>{ui("common.cancel")}</Text></Pressable>))}</>}
    </>}
    <View style={styles.sectionHeading}><Text style={styles.heading}>{onlineOnly ? ui("social.online_friends") : ui("social.your_friends")}</Text><Text style={styles.count}>{visibleFriends.length}</Text></View>
    {!visibleFriends.length && <Text style={styles.detail}>{onlineOnly ? ui("social.no_online_friends") : ui("social.no_friends_yet")}</Text>}
    <ScrollView testID="friends-list" nestedScrollEnabled style={expandedFriends ? {maxHeight:420} : undefined} scrollEnabled={expandedFriends}>
    {(friendLimit && !expandedFriends ? visibleFriends.slice(0,friendLimit) : visibleFriends).map(player => row(player, <View style={styles.actions}>
      <Pressable accessibilityRole="button" accessibilityLabel={ui('social.message')} onPress={() => void rules.run(() => { setMessages([]); setError(''); setSendError(''); setSelected(player); })} style={styles.linkButton}><View style={{flexDirection:'row',alignItems:'center',gap:6}}><Ionicons name="chatbubble-outline" size={18} color={colors.accent}/><Text style={styles.link}>{ui("social.message")}</Text></View></Pressable>

    </View>))}

    </ScrollView>
    {!!friendLimit && visibleFriends.length>friendLimit && !expandedFriends && <Pressable accessibilityRole="button" onPress={()=>setExpandedFriends(true)} style={styles.linkButton}><Text style={styles.link}>{ui("common.more")}</Text></Pressable>}
    {rules.view}
    {selected && <RoomSheet visible title={ui("social.chat_with_player", { "player": label(selected) })} closeLabel={ui("common.close_private_chat")} onClose={() => setSelected(null)} scrollable={false}
      footer={<FormFooter>
        {!!(sendError || error) && <Text accessibilityRole="alert" style={styles.error}>{sendError || error}</Text>}
        {!available && <Text style={styles.detail}>{ui("social.friend_unavailable")}</Text>}
        <CommunityRulesEntry session={session} />
        <ChatComposer value={draft} onChange={value => setDrafts(current => ({ ...current, [selected.user_id]: value }))}
          onSend={() => void send()} disabled={busy || !available} placeholder={ui("social.write_a_private_message")} label={ui("social.message_player", {player: label(selected)})} sendLabel={ui("common.send_privately")} />
      </FormFooter>}>
      <ScrollView style={{ flex: 1, minHeight: 0 }} contentContainerStyle={{ padding: 20 }} keyboardShouldPersistTaps="handled" nestedScrollEnabled>
        {!messages.length && <Text style={styles.detail}>{ui("common.no_messages_yet")}</Text>}
        {messages.map(message => <ChatMessage tableStyle key={message.id} own={message.sender_id===session.user_id}
          message={{...message,sender_name:message.sender_id===session.user_id?ui('common.you'):label(selected)}}
          action={<ReportButton session={session} enabled={blocking.reporting && !message.removed} scope="direct" messageId={message.id} player={{user_id:message.sender_id,display_name:label(selected)}}/>}/>)}
      </ScrollView>
    </RoomSheet>}
    {!!error && <Text accessibilityRole="alert" style={styles.error}>{uiLabel(error, 'feedback')}</Text>}
  </View>;
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  panel: { ...gamePanelFinish(colors), backgroundColor: colors.surface, padding: 16, borderRadius: radii.large, gap: 12 },
  title: { fontFamily: fonts.display, fontSize: typography.pageTitle, color: colors.text }, heading: { fontFamily: fonts.medium, fontSize: 16, color: colors.text },
  sectionHeading: { flexDirection:'row',alignItems:'center',gap:10,borderTopWidth:1,borderColor:colors.border,paddingTop:16,marginTop:4 },
  count: { color:colors.textMuted,backgroundColor:colors.surfaceRaised,borderRadius:16,paddingHorizontal:10,paddingVertical:4,fontFamily:fonts.medium },
  detail: { fontFamily: fonts.body, fontSize: 11, lineHeight: 18, color: colors.textMuted },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 8 }, row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10, backgroundColor:colors.surfaceRaised,borderRadius: radii.medium,padding:12 },
  name: { fontFamily: fonts.medium, fontSize: 15, color: colors.text }, actions: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  searchField: { flex:1,minWidth:0,flexDirection:'row',alignItems:'center',paddingLeft:12,borderWidth:1,borderColor:colors.border,borderRadius: radii.medium,backgroundColor:colors.background },
  input: { flex: 1, minWidth:0, padding: 12, color: colors.text, backgroundColor: 'transparent', fontFamily: fonts.body },
  button: { ...gameControlFinish(colors), minHeight: 44, paddingHorizontal: 16, borderRadius: radii.medium, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.coin, borderWidth: 1, borderColor: colors.coinBorder },
  smallButton: { minHeight: 40, paddingHorizontal: 10, borderRadius: radii.medium, alignItems: 'center', justifyContent: 'center', backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.accent },
  linkButton: { minHeight: 40, paddingHorizontal: 8, justifyContent: 'center' }, buttonText: { fontFamily: fonts.medium, fontSize: 12, color: colors.onCoin }, link: { fontFamily: fonts.medium, fontSize: 11, color: colors.accent }, disabled: { opacity: visualStates.disabledOpacity },
  message: { alignSelf: 'flex-start', maxWidth: '85%', backgroundColor: colors.background, padding: 10, borderRadius: radii.medium, marginVertical: 4 }, mine: { alignSelf: 'flex-end', backgroundColor: colors.surfaceSelected },
  messageText: { fontFamily: fonts.body, fontSize: 13, lineHeight: 19, color: colors.text }, error: { fontFamily: fonts.body, fontSize: 12, color: colors.danger },
});
