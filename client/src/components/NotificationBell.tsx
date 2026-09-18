import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { request } from '../multiplayer/api';
import type { Session } from '../multiplayer/session';
import { fonts, useTheme, useThemedStyles, type ThemeColors } from '../theme';

type Player = { user_id: string; display_name: string; username?: string | null };
type Notification = { id: string; kind: 'friend_request' | 'friend_accepted' | 'friend_rejected'; actor: Player; created_at: number; read: boolean };
type FriendSnapshot = { incoming: Player[] };
type TableInvitation = { id: string; room_id: string; room_name: string; match_id: string; table_name: string; game_type: 'callbreak' | 'marriage' | 'flush'; inviter_id: string; inviter?: Player; created_at: number; seated: number; capacity: number; seat_available: boolean };
type RoomInvitation = { id: string; room_id: string; room_name: string; inviter_id: string; inviter?: Player };

const playerName = (player: Player) => player.display_name || player.username || player.user_id;

export function NotificationBell({ session, onOpenTable, onOpenRoom }: { session: Session; onOpenTable?: (invitation: TableInvitation) => void; onOpenRoom?: (invitation: RoomInvitation) => void }) {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const compact = useWindowDimensions().width < 900;
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notification[]>([]);
  const [tableInvitations, setTableInvitations] = useState<TableInvitation[]>([]);
  const [roomInvitations, setRoomInvitations] = useState<RoomInvitation[]>([]);
  const [error, setError] = useState('');

  async function refresh(signal?: AbortSignal) {
    try {
      const [value, friends, invitations, rooms] = await Promise.all([
        request<Notification[]>('/notifications', session, undefined, signal),
        request<FriendSnapshot>('/friends', session, undefined, signal),
        request<TableInvitation[]>('/test-games/invitations', session, undefined, signal),
        request<RoomInvitation[]>('/room-invitations', session, undefined, signal),
      ]);
      const requests = friends.incoming.map(actor => ({ id: `request:${actor.user_id}`, kind: 'friend_request' as const,
        actor, created_at: Date.now(), read: false }));
      if (!signal?.aborted) { setItems([...requests, ...value]); setTableInvitations(invitations); setRoomInvitations(rooms); setError(''); }
    } catch (failure) {
      if (!signal?.aborted) setError(failure instanceof Error ? failure.message : 'Could not load notifications.');
    }
  }
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function poll() { await refresh(controller.signal); if (!controller.signal.aborted) timer = setTimeout(poll, 5000); }
    void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [session.token]);

  async function markAllRead() {
    try {
      await request('/notifications/read', session, {});
      setItems(current => current.map(item => ({ ...item, read: true })));
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not update notifications.'); }
  }
  async function answerRequest(player: Player, accept: boolean) {
    try {
      const id = encodeURIComponent(player.user_id);
      await request(accept ? `/friends/requests/${id}/accept` : `/friends/${id}`, session,
        accept ? {} : undefined, undefined, accept ? undefined : 'DELETE');
      setItems(current => current.filter(item => item.kind !== 'friend_request' || item.actor.user_id !== player.user_id));
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not update the request.'); }
  }
  async function answerTable(invitation: TableInvitation, accept: boolean) {
    try {
      await request(`/test-games/invitations/${encodeURIComponent(invitation.id)}/${accept ? 'accept' : 'decline'}`, session, {});
      setTableInvitations(current => current.filter(item => item.id !== invitation.id));
      if (accept) { setOpen(false); onOpenTable?.(invitation); }
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not update the table invitation.'); }
  }
  async function answerRoom(invitation: RoomInvitation, accept: boolean) {
    try {
      await request(`/room-invitations/${encodeURIComponent(invitation.id)}/${accept ? 'accept' : 'decline'}`, session, {});
      setRoomInvitations(current => current.filter(item => item.id !== invitation.id));
      if (accept) { setOpen(false); onOpenRoom?.(invitation); }
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not update the room invitation.'); }
  }
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
            <View><Text accessibilityRole="header" style={styles.title}>Notifications</Text><Text style={styles.detail}>Requests and social updates</Text></View>
            <Pressable accessibilityRole="button" accessibilityLabel="Close notifications" onPress={() => setOpen(false)} style={styles.close}><Text style={styles.link}>Close</Text></Pressable>
          </View>
          {!!unread && <Pressable accessibilityRole="button" onPress={() => void markAllRead()} style={styles.markRead}><Text style={styles.link}>Mark all as read</Text></Pressable>}
          <ScrollView style={styles.list}>
            {!items.length && !tableInvitations.length && !roomInvitations.length && <View style={styles.empty}><Text style={styles.name}>You’re all caught up</Text><Text style={styles.detail}>Friend and room activity will appear here.</Text></View>}
            {roomInvitations.map(invitation => <View key={invitation.id} style={[styles.notice, styles.unread]}>
              <View style={styles.avatar}><Text style={styles.avatarText}>R</Text></View>
              <View style={{ flex: 1 }}><Text style={styles.name}>{invitation.inviter ? playerName(invitation.inviter) : 'A player'} invited you to {invitation.room_name}.</Text><Text style={styles.detail}>Accepting adds this room to your memberships.</Text></View>
              <View style={styles.requestActions}>
                <Pressable accessibilityRole="button" onPress={() => void answerRoom(invitation, true)} style={styles.accept}><Text style={styles.acceptText}>Open room</Text></Pressable>
                <Pressable accessibilityRole="button" onPress={() => void answerRoom(invitation, false)} style={styles.decline}><Text style={styles.link}>Decline</Text></Pressable>
              </View>
            </View>)}
            {tableInvitations.map(invitation => <View key={invitation.id} style={[styles.notice, styles.unread]}>
              <View style={styles.avatar}><Text style={styles.avatarText}>♠</Text></View>
              <View style={{ flex: 1 }}><Text style={styles.name}>{invitation.inviter ? playerName(invitation.inviter) : 'A player'} invited you to {invitation.table_name}.</Text><Text style={styles.detail}>{invitation.room_name} · {invitation.game_type} · {invitation.seated}/{invitation.capacity} seated · {invitation.seat_available ? 'Seat available' : 'Watch or join the waitlist'} · Opening does not take a seat.</Text></View>
              <View style={styles.requestActions}>
                <Pressable accessibilityRole="button" onPress={() => void answerTable(invitation, true)} style={styles.accept}><Text style={styles.acceptText}>Open table</Text></Pressable>
                <Pressable accessibilityRole="button" onPress={() => void answerTable(invitation, false)} style={styles.decline}><Text style={styles.link}>Decline</Text></Pressable>
              </View>
            </View>)}
            {items.map(item => <View key={item.id} style={[styles.notice, !item.read && styles.unread]}>
              <View style={styles.avatar}><Text style={styles.avatarText}>{playerName(item.actor).slice(0, 1).toUpperCase()}</Text></View>
              <View style={{ flex: 1 }}><Text style={styles.name}>{playerName(item.actor)} {item.kind === 'friend_request' ? 'sent you a connection request.' : item.kind === 'friend_accepted' ? 'accepted your connection request.' : 'declined your connection request.'}</Text>
                <Text style={styles.detail}>{new Date(item.created_at).toLocaleString()}</Text></View>
              {item.kind === 'friend_request' && <View style={styles.requestActions}>
                <Pressable accessibilityRole="button" onPress={() => void answerRequest(item.actor, true)} style={styles.accept}><Text style={styles.acceptText}>Accept</Text></Pressable>
                <Pressable accessibilityRole="button" onPress={() => void answerRequest(item.actor, false)} style={styles.decline}><Text style={styles.link}>Decline</Text></Pressable>
              </View>}
            </View>)}
          </ScrollView>
          {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
        </Pressable>
      </Pressable>
    </Modal>
  </>;
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  pressed: { backgroundColor: colors.surfaceSelected }, badge: { position: 'absolute', right: 3, top: 3, minWidth: 17, height: 17, paddingHorizontal: 4, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary },
  badgeText: { color: colors.onPrimary, fontFamily: fonts.medium, fontSize: 9 }, backdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end', alignItems: 'center' },
  sheet: { width: '100%', maxHeight: '78%', backgroundColor: colors.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 20, gap: 12 },
  desktopSheet: { width: 420, maxHeight: 560, alignSelf: 'flex-end', marginRight: 28, marginBottom: 28, borderRadius: 18 },
  headingRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 }, title: { fontFamily: fonts.display, fontSize: 24, color: colors.text },
  detail: { fontFamily: fonts.body, fontSize: 11, lineHeight: 18, color: colors.textMuted }, close: { minWidth: 44, minHeight: 44, justifyContent: 'center', alignItems: 'center' }, link: { fontFamily: fonts.medium, fontSize: 12, color: colors.accent },
  markRead: { alignSelf: 'flex-end', minHeight: 40, justifyContent: 'center' }, list: { maxHeight: 440 }, notice: { flexDirection: 'row', gap: 10, paddingVertical: 13, borderBottomWidth: 1, borderColor: colors.border },
  unread: { backgroundColor: colors.surfaceSelected, marginHorizontal: -8, paddingHorizontal: 8, borderRadius: 10 }, avatar: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background }, avatarText: { fontFamily: fonts.medium, color: colors.accent },
  name: { fontFamily: fonts.medium, fontSize: 13, lineHeight: 19, color: colors.text }, empty: { paddingVertical: 36, alignItems: 'center', gap: 5 }, error: { color: colors.danger, fontFamily: fonts.body, fontSize: 11 },
  requestActions: { alignItems: 'stretch', gap: 4 }, accept: { minHeight: 34, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center', borderRadius: 8, backgroundColor: colors.primary }, acceptText: { fontFamily: fonts.medium, fontSize: 11, color: colors.onPrimary }, decline: { minHeight: 34, paddingHorizontal: 8, alignItems: 'center', justifyContent: 'center' },
});
