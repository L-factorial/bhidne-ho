import {useFreshSoundEvents} from '../notifications/useFreshSoundEvents';
import {useForegroundSound} from '../notifications/useForegroundSound';
import {acknowledgeNotificationAction, onNotificationsAcknowledged} from '../multiplayer/useNotificationAction';
import {AppText as Text} from './AppText';
import { retryingError, playerError } from '../multiplayer/playerError.ts';
import { ui, uiLabel } from '../i18n/copy.ts';
import { useUiLanguage } from '../i18n/useUiLanguage';
import { useEffect, useRef, useState } from 'react';
import {Modal, Pressable, ScrollView, StyleSheet, View, useWindowDimensions} from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { request } from '../multiplayer/api';
import type { Session } from '../multiplayer/session';
import { radii, fonts, useTheme, useThemedStyles, type ThemeColors } from '../theme';
import type {Invitation} from '../multiplayer/invitations';

type Player = { user_id: string; display_name: string; username?: string | null };
type Notification = { id: string; kind: 'friend_request' | 'friend_accepted' | 'friend_rejected' | 'chat' | 'poke' | 'settlement_requested' | 'settlement_accepted'; payload?: {batch_id?:string;transfer_id?:string;table_id?:string;amount?:number;room_id?:string;match_id?:string;scope?:string;source_id?:string;game_id?:string;room_name?:string;table_name?:string}; actor: Player; created_at: number; read: boolean };
type FriendSnapshot = { incoming: Player[] };
type TableInvitation = { room_notification?:boolean; id: string; room_id: string; room_name: string; match_id: string; table_name: string; game_type: 'callbreak' | 'marriage' | 'flush'; inviter_id: string; inviter?: Player; created_at: number; seated: number; capacity: number; seat_available: boolean };
type RoomInvitation = { id: string; room_id: string; room_name: string; inviter_id: string; inviter?: Player };

const playerName = (player: Player) => player.display_name || player.username || player.user_id;

export function NotificationBell({ session, onOpenTable, onOpenRoom, onOpenActivity }: { session: Session; onOpenActivity?: (target:Invitation)=>void; onOpenTable?: (invitation: TableInvitation) => void; onOpenRoom?: (invitation: RoomInvitation) => void }) {
  useUiLanguage();
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const compact = useWindowDimensions().width < 900;
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notification[]>([]);
  const [tableInvitations, setTableInvitations] = useState<TableInvitation[]>([]);
  const [roomInvitations, setRoomInvitations] = useState<RoomInvitation[]>([]);
  const [error, setError] = useState('');
  const refreshVersion = useRef(0);
  const {play:playSound}=useForegroundSound();
  const freshInvitations=useFreshSoundEvents(session.token);
  const freshDirectChat=useFreshSoundEvents(session.token);
  const [clearing, setClearing] = useState(false);

  async function refresh(signal?: AbortSignal) {
    const version = refreshVersion.current;
    try {
      const [value, friends, invitations, rooms] = await Promise.all([
        request<Notification[]>('/notifications', session, undefined, signal),
        request<FriendSnapshot>('/friends', session, undefined, signal),
        request<TableInvitation[]>('/test-games/invitations', session, undefined, signal),
        request<RoomInvitation[]>('/room-invitations', session, undefined, signal),
      ]);
      const requests = friends.incoming.map(actor => ({ id: `request:${actor.user_id}`, kind: 'friend_request' as const,
        actor, created_at: Date.now(), read: false }));
      if (!signal?.aborted && version === refreshVersion.current) {
        const ids=[...invitations.map(i=>`table:${i.id}`),...rooms.map(i=>`room:${i.id}`)];
        const fresh=freshInvitations(ids);
        if(fresh?.length)playSound('invitation',`invite:${session.user_id}:${fresh.at(-1)}`);
        const chats=value.filter(item=>!item.read&&item.kind==='chat'&&item.payload?.scope==='direct');
        const freshChat=freshDirectChat(chats.map(item=>item.payload?.source_id??item.id));
        if(freshChat.length)playSound('chat',`chat:${freshChat.at(-1)}`);
        setItems([...requests, ...value.filter(item => !item.read && item.kind !== 'friend_request')]); setTableInvitations(invitations); setRoomInvitations(rooms); setError(''); }
    } catch (failure) {
      if (!signal?.aborted) setError(retryingError(failure, ui("feedback.could_not_load_notifications")));
    }
  }
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function poll() { await refresh(controller.signal); if (!controller.signal.aborted) timer = setTimeout(poll, 5000); }
    void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [session.token]);

  useEffect(()=>onNotificationsAcknowledged((account,ids)=>{
    if(account.user_id!==session.user_id||account.token!==session.token)return;
    refreshVersion.current++;setItems(current=>current.filter(item=>!ids.includes(item.id)));
  }),[session.user_id,session.token]);

  async function markAllRead() {
    if (clearing) return;
    setClearing(true);
    refreshVersion.current++;
    try {
      await request('/notifications/read', session, {});
      refreshVersion.current++;
      setItems(current => current.filter(item => item.kind === 'friend_request'));
      setError('');
    } catch (failure) { setError(playerError(failure, ui("feedback.could_not_update_notifications"))); }
    finally { setClearing(false); }
  }
  async function answerRequest(player: Player, accept: boolean) {
    try {
      const id = encodeURIComponent(player.user_id);
      await request(accept ? `/friends/requests/${id}/accept` : `/friends/${id}`, session,
        accept ? {} : undefined, undefined, accept ? undefined : 'DELETE');
      refreshVersion.current++;
      setItems(current => current.filter(item => item.kind !== 'friend_request' || item.actor.user_id !== player.user_id));
    } catch (failure) { setError(playerError(failure, ui("feedback.could_not_update_the_request"))); }
  }
  async function answerTable(invitation: TableInvitation, accept: boolean) {
    try {
      await request(`/test-games/invitations/${encodeURIComponent(invitation.id)}/${accept ? 'accept' : 'decline'}`, session, {});
      refreshVersion.current++;
      setTableInvitations(current => current.filter(item => item.id !== invitation.id));
      await acknowledgeNotificationAction(session,{kind:'table',roomId:invitation.room_id,matchId:invitation.match_id}).catch(()=>{});
      if (accept) { setOpen(false); onOpenTable?.(invitation); }
    } catch (failure) { setError(playerError(failure, ui("feedback.could_not_update_the_table_invitation"))); }
  }
  async function answerRoom(invitation: RoomInvitation, accept: boolean) {
    try {
      await request(`/room-invitations/${encodeURIComponent(invitation.id)}/${accept ? 'accept' : 'decline'}`, session, {});
      refreshVersion.current++;
      setRoomInvitations(current => current.filter(item => item.id !== invitation.id));
      await acknowledgeNotificationAction(session,{kind:'room',roomId:invitation.room_id}).catch(()=>{});
      if (accept) { setOpen(false); onOpenRoom?.(invitation); }
    } catch (failure) { setError(playerError(failure, ui("feedback.could_not_update_the_room_invitation"))); }
  }
  function openActivity(item:Notification){
    setOpen(false);
    onOpenActivity?.({roomId:item.payload?.scope==='direct'?'':item.payload?.room_id??'',
      matchId:item.kind.startsWith('settlement_')?undefined:item.payload?.match_id,otherUserId:item.payload?.scope==='direct'||item.kind.startsWith('friend_')?item.actor.user_id:undefined,
      scope:item.payload?.scope as Invitation['scope'],gameId:item.payload?.game_id,notificationKind:item.kind,eventId:item.id,recipientId:session.user_id});
  }
  const actionArrow = <Svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={colors.onPrimary} strokeWidth={2} accessible={false}><Path d="M5 12h14M12 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round" /></Svg>;
  const clearable = items.some(item => item.kind !== 'friend_request');
  const pending = items.some(item => item.kind === 'friend_request') || !!tableInvitations.length || !!roomInvitations.length;
  const unread = items.filter(item => !item.read).length + tableInvitations.length + roomInvitations.length;
  return <>
    <Pressable accessibilityRole="button" accessibilityLabel={`Notifications${unread ? `, ${unread} unread` : ''}`}
      onPress={() => setOpen(true)} style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}>
      <Svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={colors.accent} strokeWidth={1.8} accessible={false}>
        <Path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" strokeLinecap="round" strokeLinejoin="round" />
      </Svg>
      {!!unread && <View style={styles.badge}><Text style={styles.badgeText}>{unread > 9 ? '9+' : unread}</Text></View>}
    </Pressable>
    <Modal visible={open} transparent animationType={compact ? 'slide' : 'fade'} onRequestClose={() => setOpen(false)}>
      <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
        <Pressable accessibilityViewIsModal style={[styles.sheet, !compact && styles.desktopSheet]} onPress={() => {}}>
          <View style={styles.headingRow}>
            <View><Text accessibilityRole="header" style={styles.title}>{ui("common.notifications")}</Text><Text style={styles.detail}>{ui("social.requests_and_social_updates")}</Text></View>
            <Pressable accessibilityRole="button" accessibilityLabel={ui("common.close_notifications")} onPress={() => setOpen(false)} style={styles.close}><Text style={styles.link}>{ui("common.close")}</Text></Pressable>
          </View>
          {clearable && <View style={{flexDirection:'row',flexWrap:'wrap',justifyContent:'flex-end',gap:16}}><Pressable disabled={clearing} accessibilityRole="button" onPress={() => void markAllRead()} style={styles.markRead}><Text style={styles.link}>{ui("common.mark_all_as_read")}</Text></Pressable><Pressable accessibilityRole="button" disabled={clearing} onPress={() => void markAllRead()} style={styles.markRead}><Text style={styles.link}>{ui("common.clear_notifications")}</Text></Pressable></View>}
          {pending && <Text style={styles.detail}>{ui("common.pending_notifications_help")}</Text>}
          <ScrollView style={styles.list}>
            {!items.length && !tableInvitations.length && !roomInvitations.length && <View style={styles.empty}><Text style={styles.name}>{ui("common.you_re_all_caught_up")}</Text><Text style={styles.detail}>{ui("social.friend_and_room_activity_will_appear_here")}</Text></View>}
            {roomInvitations.map(invitation => <View key={invitation.id} style={[styles.notice, styles.unread]}>
              <View style={styles.avatar}><Text style={styles.avatarText}>R</Text></View>
              <View style={styles.noticeContent}><Text style={styles.name}>{ui("social.player_invited_you_to_tablename", { "player": invitation.inviter ? playerName(invitation.inviter) : 'A player', "tableName": invitation.room_name })}</Text><Text style={styles.detail}>{ui("common.accepting_adds_this_room_to_your_memberships")}</Text></View>
              <View style={styles.requestActions}>
                <Pressable accessibilityRole="button" accessibilityLabel={ui("common.open_room")} onPress={() => void answerRoom(invitation, true)} style={styles.navigate}>{actionArrow}</Pressable>
                <Pressable accessibilityRole="button" accessibilityLabel={ui("common.decline")} onPress={() => void answerRoom(invitation, false)} style={styles.navigate}>{actionArrow}</Pressable>
              </View>
            </View>)}
            {tableInvitations.map(invitation => <View key={invitation.id} style={[styles.notice, styles.unread]}>
              <View style={styles.avatar}><Text style={styles.avatarText}>♠</Text></View>
              <View style={styles.noticeContent}><Text style={styles.name}>{ui(invitation.room_notification ? "social.player_created_table" : "social.player_invited_you_to_tablename", { "player": invitation.inviter ? playerName(invitation.inviter) : ui("common.player"), "tableName": invitation.table_name, "roomName": invitation.room_name })}</Text><Text style={styles.detail}>{ui("rooms.invitation_summary", { "game": invitation.room_name, "phase": invitation.game_type, "seated": invitation.seated, "capacity": invitation.capacity, "players": invitation.seat_available ? ui("rooms.seat_available") : ui("rooms.watch_or_join_the_waitlist") })}</Text></View>
              <View style={styles.requestActions}>
                <Pressable accessibilityRole="button" accessibilityLabel={ui("common.open_table")} onPress={() => void answerTable(invitation, true)} style={styles.navigate}>{actionArrow}</Pressable>
                <Pressable accessibilityRole="button" accessibilityLabel={ui("common.decline")} onPress={() => void answerTable(invitation, false)} style={styles.navigate}>{actionArrow}</Pressable>
              </View>
            </View>)}
            {items.map(item => <View key={item.id} style={[styles.notice, !item.read && styles.unread]}>
              <View style={styles.avatar}><Text style={styles.avatarText}>{playerName(item.actor).slice(0, 1).toUpperCase()}</Text></View>
              <View style={styles.noticeContent}><Text style={styles.name}>{playerName(item.actor)} {item.kind === 'settlement_requested' ? ui('ledger.settlement_requested') : item.kind === 'settlement_accepted' ? ui('ledger.settlement_accepted') : item.kind === 'friend_request' ? ui("social.sent_you_a_connection_request") : item.kind === 'friend_accepted' ? ui("social.accepted_your_connection_request") : item.kind === 'chat' ? ui("social.sent_you_a_chat_message") : item.kind === 'poke' ? ui("social.poked_you") : ui("social.declined_your_connection_request")}</Text>
                <Text style={styles.detail}>{[item.payload?.room_name,item.payload?.table_name,item.payload?.amount].filter(value => value !== undefined && value !== '').join(" · ")}</Text><Text style={styles.detail}>{new Date(item.created_at).toLocaleString()}</Text></View>
              <View style={styles.requestActions}>
              {item.kind === 'friend_request' && <View style={styles.requestActions}>
                <Pressable accessibilityRole="button" accessibilityLabel={ui("common.accept")} onPress={() => void answerRequest(item.actor, true)} style={styles.navigate}>{actionArrow}</Pressable>
                <Pressable accessibilityRole="button" accessibilityLabel={ui("common.decline")} onPress={() => void answerRequest(item.actor, false)} style={styles.navigate}>{actionArrow}</Pressable>
              </View>}
              {onOpenActivity&&<Pressable accessibilityRole="button"
                accessibilityLabel={ui(item.kind.startsWith('settlement_')?'ledger.ledger_settlements':item.kind.startsWith('friend_')?'common.friends':item.payload?.scope==='direct'?'social.chat':item.payload?.match_id?'common.open_table':'common.open_room')}
                onPress={()=>void openActivity(item)}
                style={({pressed})=>[styles.navigate,pressed&&styles.navigatePressed]}>
                <Svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={colors.onPrimary} strokeWidth={2} accessible={false}>
                  <Path d="M5 12h14M12 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round" />
                </Svg>
              </Pressable>}
              </View>
            </View>)}
          </ScrollView>
          {!!error && <Text activity accessibilityRole="alert" style={styles.error}>{uiLabel(error, 'feedback')}</Text>}
        </Pressable>
      </Pressable>
    </Modal>
  </>;
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: radii.medium, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  pressed: { backgroundColor: colors.surfaceSelected }, badge: { position: 'absolute', right: 3, top: 3, minWidth: 17, height: 17, paddingHorizontal: 4, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary },
  badgeText: { color: colors.onPrimary, fontFamily: fonts.medium, fontSize: 9 }, backdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end', alignItems: 'center' },
  sheet: { width: '100%', maxHeight: '78%', backgroundColor: colors.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 20, gap: 12 },
  desktopSheet: { width: 420, maxHeight: 560, alignSelf: 'flex-end', marginRight: 28, marginBottom: 28, borderRadius: radii.large },
  headingRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 }, title: { fontFamily: fonts.display, fontSize: 24, color: colors.text },
  detail: { fontFamily: fonts.body, fontSize: 11, lineHeight: 18, color: colors.textMuted }, close: { minWidth: 44, minHeight: 44, justifyContent: 'center', alignItems: 'center' }, link: { fontFamily: fonts.medium, fontSize: 12, color: colors.accent },
  markRead: { alignSelf: 'flex-end', minHeight: 40, justifyContent: 'center' }, list: { maxHeight: 440 }, notice: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 13, borderBottomWidth: 1, borderColor: colors.border },
  unread: { backgroundColor: colors.surfaceSelected, marginHorizontal: -8, paddingHorizontal: 8, borderRadius: radii.medium }, avatar: { width: 36, height: 36, borderRadius: radii.large, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background }, avatarText: { fontFamily: fonts.medium, color: colors.accent },
  name: { fontFamily: fonts.medium, fontSize: 13, lineHeight: 19, color: colors.text }, empty: { paddingVertical: 36, alignItems: 'center', gap: 5 }, error: { color: colors.danger, fontFamily: fonts.body, fontSize: 11 },
  noticeContent: {flex:1,minWidth:0},
  navigate: { alignSelf: 'center', flexShrink: 0, width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: radii.medium, backgroundColor: colors.primary },
  navigatePressed: { opacity: 0.75 },
  requestActions: { alignSelf: 'center', alignItems: 'stretch', flexShrink: 0, gap: 4 },
});
