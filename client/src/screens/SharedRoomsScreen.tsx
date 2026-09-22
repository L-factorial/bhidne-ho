import { ActiveGames, type ActiveTable } from '../components/ActiveGames';
import type { TableEntry } from '../multiplayer/tableNavigation';
import { RoomMemberDetails } from '../components/RoomMemberDetails';
import { FormInput, FormScrollView } from '../components/FormInput';
import { KeyboardFrame } from '../components/KeyboardFrame';
import { FormFooter } from '../components/FormFooter';
import { Ionicons } from '@expo/vector-icons';
import { RoomToolbar } from '../components/RoomToolbar';
import { RoomSheet } from '../components/RoomSheet';
import { LobbyNavigation } from '../components/LobbyNavigation';
import { useRecentRooms } from '../multiplayer/useRecentRooms';
import { RoomCard } from '../components/RoomCard';
import { useRoomChat } from '../components/RoomChat';
import { InvitationPreview } from '../components/InvitationPreview';
import { CopyRoomCode, RoomShareActions, ShareLink } from '../components/ShareLink';
import { readJoinTarget, type Invitation } from '../multiplayer/invitations';
import { AppHeader, HeaderProfileContext } from '../components/AppHeader';
import { HeaderAction } from '../components/HeaderAction';
import { NotificationBell } from '../components/NotificationBell';
import { GameIcon } from '../components/BrandArt';
import { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { fonts, useTheme, useThemedStyles, type ThemeColors } from '../theme';
import { ProfileScreen } from './ProfileScreen';
import { usePlayerPhrases } from '../multiplayer/usePlayerPhrases';
import { RoomGameControl } from '../components/RoomGameControl';
import { FriendsPanel } from '../components/FriendsPanel';
import { RoomLedger } from '../components/RoomLedger';

import { apiUrl, request } from '../multiplayer/api';
import type { Room } from '../multiplayer/session';
import { useRoomSession } from '../multiplayer/useRoomSession';
import { SocialSignInButtons } from '../components/SocialSignInButtons';

type InvitePlayer = { user_id: string; display_name: string; username?: string | null };

export function SharedRoomsScreen({ onExit, invitation: externalInvitation, dismissInvitation }: { onExit: () => void; invitation?: Invitation | null; dismissInvitation?: () => void }) {
  const [codeInvitation, setCodeInvitation] = useState<Invitation | null>(null);
  const invitation = codeInvitation || externalInvitation;
  const clearInvitation = () => { setCodeInvitation(null); dismissInvitation?.(); };
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const insets = useSafeAreaInsets();
  const wide = useWindowDimensions().width >= 900;
  const [roomToolsOpen, setRoomToolsOpen] = useState(false);
  const [roomOptionsOpen, setRoomOptionsOpen] = useState(false);
  const [lobbyTab, setLobbyTab] = useState<'rooms' | 'players' | 'recent' | 'games'>('rooms');
  const [lobbyProfileOpen, setLobbyProfileOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [memberProfiles, setMemberProfiles] = useState<Record<string, InvitePlayer>>({});
  const [memberError, setMemberError] = useState('');
  const [memberRetry, setMemberRetry] = useState(0);
  const [selectedMember, setSelectedMember] = useState<InvitePlayer | null>(null);
  const [roomPanel, setRoomPanel] = useState<'chat' | 'members' | 'more' | 'ledger' | null>(null);
  const [form, setForm] = useState<'create' | 'join'>('create');
  const [linkedMatch, setLinkedMatch] = useState<string>();
  const [linkedEntry, setLinkedEntry] = useState<{ matchId: string; action: TableEntry }>();
  const [authMode, setAuthMode] = useState<'signin' | 'signup'>('signin');
  const [username, setUsername] = useState('');
  const [profileName, setProfileName] = useState('');
  const missingProfileName = authMode === 'signup' && !profileName.trim();
  const [password, setPassword] = useState('');
  const usernameInput = useRef<TextInput>(null), passwordInput = useRef<TextInput>(null);
  const shared = useRoomSession();
  const { session, rooms, room, game, setGame, expired } = shared;
  const recentIds = useRecentRooms(session?.user_id, room?.room_id);
  const [gameOpen, setGameOpen] = useState(false);
  const chat = useRoomChat({ roomId: room?.room_id || '', session: session || { token: '', user_id: '' }, connected: !!room && !!session && !expired && !gameOpen && shared.status === 'connected',
    launcherVisible: false, expanded: roomPanel === 'chat', onExpandedChange: open => setRoomPanel(current => open ? 'chat' : current === 'chat' ? null : current), bottomOffset: 56,
    renderLauncher: ({ unread, blocked, toggle }) => <RoomToolbar inline={roomPanel === null} onLedger={() => setRoomPanel('ledger')} panel={roomPanel} unread={unread} chatBlocked={blocked} onTables={() => setRoomPanel(null)} onChat={toggle} onMembers={() => setRoomPanel('members')} onMore={() => setRoomPanel('more')} />,
  });
  useEffect(() => {
    setInviteOpen(false); setRoomPanel(null); setSelectedMember(null);
  }, [room?.room_id]);
  useEffect(() => { if (gameOpen) setRoomPanel(null); }, [gameOpen]);
  const personal = usePlayerPhrases(session, !!session && !expired);
  const [name, setName] = useState('');
  const [visibility, setVisibility] = useState<'public' | 'friends'>('public');
  const [code, setCode] = useState('');
  const [roomInviteQuery, setRoomInviteQuery] = useState('');
  const [roomInviteResults, setRoomInviteResults] = useState<InvitePlayer[]>([]);
  const [roomInvitees, setRoomInvitees] = useState<InvitePlayer[]>([]);
  const [roomInviteError, setRoomInviteError] = useState('');
  const [roomInviteSearching, setRoomInviteSearching] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [deleteConfirming, setDeleteConfirming] = useState(false);

  const mounted = useRef(true);
  const roomOperationPending = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  async function leaveMembership() {
    if (!await shared.leaveRoom()) return; setRoomToolsOpen(false); setError('');
  }
  function joinRoom(target: Room, targetGame?: 'callbreak' | 'marriage' | 'flush') {
    if (roomOperationPending.current || busy) return;
    roomOperationPending.current = true;
    setBusy(true); setLinkedMatch(undefined); setError('');
    void shared.joinRoom(target, targetGame).then(ok => { if (ok) setRoomToolsOpen(false); }).finally(() => { roomOperationPending.current = false; if (mounted.current) setBusy(false); });
  }
  function joinByCode() {
    if (!session || busy || expired || roomOperationPending.current) return;
    const target = readJoinTarget(code);
    if (!target) { setError('Enter a valid room code, table code, or invitation link.'); return; }
    setError('');
    if (target.matchId) { setCodeInvitation(target); setRoomToolsOpen(false); return; }
    joinRoom(rooms.find(item => item.room_id === target.roomId) || { room_id: target.roomId, name: 'Joined room', members: [] });
  }
  function enterRoom(target: Room, targetGame?: 'callbreak' | 'marriage' | 'flush') {
    setRoomToolsOpen(false); shared.enterRoom(target, targetGame); setError('');
  }
  async function enterActiveTable(table: ActiveTable, action: TableEntry) {
    if (!session || busy || roomOperationPending.current) return;
    const target = rooms.find(item => item.room_id === table.room_id);
    if (!target) { setError('This room is no longer available. Refresh the lobby.'); return; }
    roomOperationPending.current = true; setBusy(true); setError('');
    setLinkedEntry({ matchId: table.match_id, action }); setLinkedMatch(table.match_id);
    try { await shared.joinRoom(target, table.game_type); }
    finally { roomOperationPending.current = false; setBusy(false); }
  }
  function signOut() { void shared.signOut(); onExit(); }
  async function createRoom() {
    if (!session || roomOperationPending.current || busy || expired) return;
    if (!name.trim()) { setError('Enter a room name.'); return; }
    roomOperationPending.current = true; setBusy(true); setError('');
    try {
      const created = await request<Room>('/rooms', session, { name: name.trim(), visibility, invitees: roomInvitees.map(player => player.user_id) });
      if (!mounted.current) return;
      setName(''); setRoomInviteQuery(''); setRoomInviteResults([]); setRoomInvitees([]); enterRoom(created);
    } catch (error) { if (mounted.current) setError(error instanceof Error ? error.message : 'Could not create room.'); }
    finally { roomOperationPending.current = false; if (mounted.current) setBusy(false); }
  }
  useEffect(() => {
    if (!session || !roomToolsOpen || form !== 'create' || roomInviteQuery.trim().length < 2) { setRoomInviteResults([]); return; }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const players = await request<InvitePlayer[]>(`/players/search?q=${encodeURIComponent(roomInviteQuery.trim())}`, session, undefined, controller.signal);
        if (!controller.signal.aborted) { setRoomInviteResults(players); setRoomInviteError(''); }
      } catch (failure) { if (!controller.signal.aborted) setRoomInviteError(failure instanceof Error ? failure.message : 'Could not search recent players.'); }
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [form, roomInviteQuery, roomToolsOpen, session?.token]);
  async function searchRoomDirectory() {
    if (!session || roomInviteQuery.trim().length < 2 || roomInviteSearching) return;
    setRoomInviteSearching(true); setRoomInviteError('');
    try {
      const players = await request<InvitePlayer[]>(`/players/directory?q=${encodeURIComponent(roomInviteQuery.trim())}`, session);
      setRoomInviteResults(players);
      if (!players.length) setRoomInviteError('No player found with that exact name, username, or user ID.');
    } catch (failure) { setRoomInviteError(failure instanceof Error ? failure.message : 'Could not search the player directory.'); }
    finally { setRoomInviteSearching(false); }
  }
  const current = rooms.find(item => item.room_id === room?.room_id) || room;
  const enterRooms = rooms.filter(item => item.creator_id === session?.user_id || item.members.includes(session?.user_id || ''));
  const friendRooms = rooms.filter(item => !enterRooms.includes(item) && item.feed_source === 'friend');

  const recentRooms = recentIds.map(id => rooms.find(item => item.room_id === id)).filter((item): item is Room => !!item);

  const roomCard = (item: Room) => <View key={item.room_id} style={wide ? { width: '48.8%' } : { width: '100%' }}>
    <RoomCard room={item} member={enterRooms.includes(item)} busy={busy}
      activeTables={shared.memberships.find(m => m.room_id === item.room_id)?.tables.filter(t => t.status !== 'ended').length}
      onPress={() => { setLinkedMatch(undefined); if (enterRooms.includes(item)) enterRoom(item); else joinRoom(item); }} />
  </View>;
  const previewMembers = (current?.member_previews || []).filter(member => member.display_name?.trim()).slice(0, 4);
  const roomMembers = [...new Set([...(current?.members || []), ...(room && session && shared.status === 'connected' ? [session.user_id] : [])])];
  const selectedGame = game === 'flush' || game === 'marriage' ? game : 'callbreak';
  const memberKey = [...roomMembers].sort().join(',');
  useEffect(() => {
    if (!session || !room || roomPanel !== 'members') return;
    const controller = new AbortController();
    setMemberProfiles({}); setMemberError('');
    void request<InvitePlayer[]>(`/rooms/${encodeURIComponent(room.room_id)}/members`, session, undefined, controller.signal)
      .then(players => {
        if (!controller.signal.aborted) setMemberProfiles(Object.fromEntries(players.map(player => [player.user_id, player])));
      }).catch(() => {
        if (!controller.signal.aborted) setMemberError('Could not load member names.');
      });
    return () => controller.abort();
  }, [session?.token, room?.room_id, roomPanel, memberKey, memberRetry]);

  return <HeaderProfileContext.Provider value={session && !expired ? close => <ProfileScreen session={session} personal={personal} onBack={close} onSignOut={signOut} /> : null}><KeyboardFrame><FormScrollView keyboardShouldPersistTaps="handled" style={styles.page} contentContainerStyle={[styles.container, room && { flexGrow: 1 }, {
    paddingTop: Math.max(insets.top, 16), paddingBottom: (room ? Math.max(insets.bottom, 28) + 64 : 24),
  }]}>
    <View style={[styles.content, room && { flexGrow: 1, maxWidth: 760 }]}>
      <AppHeader lobby={!room && !!session} onOpenProfile={!room ? () => setLobbyProfileOpen(true) : undefined} inlineActions={session && !expired ? <NotificationBell session={session} onOpenTable={invited => {
        setLinkedMatch(invited.match_id);
        enterRoom({ room_id: invited.room_id, name: invited.table_name, members: [] }, invited.game_type);
      }} onOpenRoom={invited => enterRoom({ room_id: invited.room_id, name: invited.room_name, members: [] })} /> : null} />
      {session && !roomToolsOpen && !!(error || shared.error) && <Text accessibilityRole="alert" style={styles.error}>{error || shared.error}</Text>}
      {room && !expired && shared.status !== 'connected'  && <Text accessibilityLiveRegion="polite" style={styles.subtitle}>Reconnecting to your room…</Text>}
      {invitation && session ? <InvitationPreview key={`${invitation.roomId}:${invitation.matchId}`} invitation={invitation} session={session}
        dismiss={clearInvitation} join={async (target, gameType, matchId) => {
          const joined = await shared.joinRoom(target, gameType);
          if (joined) { setLinkedMatch(matchId); clearInvitation(); }
          return joined;
        }} /> : room ? <>
        <View testID="room-hero" style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderSubtle, borderRadius: 24, padding: 16, gap: 18, marginTop: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <Pressable accessibilityRole="button" accessibilityLabel="Back to lobby" onPress={() => { setLinkedMatch(undefined); shared.exitRoom(); }} style={{ minWidth: 44, minHeight: 44, justifyContent: 'center' }}><Ionicons name="arrow-back" size={24} color={colors.accent} /></Pressable>
            <View style={{ flex: 1 }}><Text accessibilityRole="header" style={{ fontFamily: fonts.editorial, fontSize: 30, color: colors.text }}>{current?.name || room.name}</Text>
              <Text style={{ fontFamily: fonts.body, color: colors.textMuted, fontSize: 13 }}>{roomMembers.length} members · {current?.connected_members?.length || 0} online</Text><CopyRoomCode roomId={room.room_id} inline menu />
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel="More room actions" onPress={() => setRoomPanel('more')} style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}><Ionicons name="settings-outline" size={25} color={colors.accent} /></Pressable>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Pressable accessibilityRole="button" accessibilityLabel="Preview room members" onPress={() => setRoomPanel('members')} style={{ flex: 1, flexDirection: 'row', gap: 5, minHeight: 44, alignItems: 'center' }}>
              {previewMembers.map(member => <View key={member.user_id} accessibilityLabel={member.display_name} style={{ width: 36, height: 36, borderRadius: 18, borderWidth: 2, borderColor: colors.tableTrim, backgroundColor: colors.surfaceRaised, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: colors.text, fontFamily: fonts.medium }}>{member.display_name.trim().slice(0, 1).toUpperCase()}</Text></View>)}
              {roomMembers.length > previewMembers.length && <Text style={{ color: colors.textMuted, fontFamily: fonts.medium }}>+{roomMembers.length - previewMembers.length}</Text>}
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Invite to room" onPress={() => { setInviteOpen(true); setRoomPanel('members'); }} style={{ borderWidth: 1, borderColor: colors.primary, backgroundColor: colors.primary, paddingHorizontal: 20, minHeight: 44, borderRadius: 12, justifyContent: 'center' }}><Text style={{ color: colors.onPrimary, fontFamily: fonts.medium }}>Invite</Text></Pressable>
          </View>
        </View>
        {!gameOpen && roomPanel === null && chat.navigation}
        <View style={[styles.columns, { flex: 1 }]}>
          <View style={styles.mainColumn}>
            {session && <RoomGameControl socialChannel={shared.socialChannel} onOpenChange={setGameOpen} requestedMatchId={linkedMatch} requestedEntry={linkedEntry && linkedEntry.matchId === linkedMatch ? linkedEntry.action : undefined} personal={personal} key={room.room_id} roomId={room.room_id} apiUrl={apiUrl} token={session.token} userId={session.user_id} pokes={shared.pokes} connected={shared.status === 'connected' && !expired} members={current?.connected_members || []} roomMembers={roomMembers} connectionMessage={expired ? shared.error : undefined}
              gameType={selectedGame} createContent={<>
            <Text style={styles.eyebrowDark}>CHOOSE A GAME</Text>
            <View style={styles.gameTabs}>
              {(['callbreak', 'flush', 'marriage'] as const).map(value => <Pressable key={value} accessibilityRole="button"
                accessibilityLabel={`Choose ${value === 'callbreak' ? 'Call Break' : value === 'flush' ? 'Flush' : 'Marriage'}`}
                accessibilityState={{ selected: selectedGame === value }} onPress={() => setGame(value)}
                style={[styles.gameTab, selectedGame === value && styles.selectedTab]}>
                <GameIcon game={value} />
                <Text style={[styles.tabText, selectedGame === value && styles.selectedTabText]}>{value === 'callbreak' ? 'Call Break' : value === 'flush' ? 'Flush' : 'Marriage'}</Text>
              </Pressable>)}
            </View>
              {selectedGame === 'callbreak' ? <Text style={styles.description}>Four or five players. Five deals. Make your call.</Text>
                : selectedGame === 'marriage' ? <Text style={styles.description}>Two to five players. Build your melds, unlock Maal, and finish with eight Dublees.</Text>
                : <Text style={styles.description}>Two to ten players. Bet blind or seen, pack, and show when two players remain.</Text>}
              </>} />}
          </View>
        </View>
        {session && <RoomMemberDetails member={selectedMember} session={session} online={!!selectedMember && !!current?.connected_members?.includes(selectedMember.user_id)} onClose={() => { setSelectedMember(null); setRoomPanel('members'); }} />}
        {session && <RoomSheet visible={!gameOpen && roomPanel !== null && roomPanel !== 'chat'} title={roomPanel === 'members' ? `Members · ${roomMembers.length}` : roomPanel === 'ledger' ? 'Ledger & settlements' : 'Room options'} onClose={() => setRoomPanel(null)}
          footer={<>{roomPanel === 'members' && <View style={{ paddingHorizontal: 20, paddingVertical: 8, borderTopWidth: 1, borderColor: colors.borderSubtle }}>
              <Pressable accessibilityRole="button" accessibilityLabel="Invite people" aria-expanded={inviteOpen} accessibilityState={{ expanded: inviteOpen }} onPress={() => setInviteOpen(value => !value)} style={styles.sectionToggle}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}><Ionicons name="person-add-outline" size={21} color={colors.accent} /><Text style={styles.sectionTitle}>Invite people</Text></View><Text style={styles.sectionTitle}>{inviteOpen ? '-' : '+'}</Text>
              </Pressable>
            {inviteOpen && <View style={styles.panel}>
              <View>
                <Text style={styles.description}>Share the room link or code. After entering, each person can choose a table to play or watch.</Text>
                <View style={styles.codeBox}><Text style={styles.codeLabel}>ROOM CODE</Text><Text selectable accessibilityLabel={`Room code ${room.room_id}`} style={styles.code}>{room.room_id}</Text></View>
                <View style={styles.gameTabs}><ShareLink roomId={room.room_id} /><CopyRoomCode roomId={room.room_id} /></View>
              </View>
            </View>}
          </View>}
          <View style={{ height: 64 + Math.max(8, insets.bottom) }}>{chat.navigation}</View>
        </>}>
          {roomPanel === 'members' && <>
            {!!memberError && <View style={{ gap: 8 }}><Text accessibilityRole="alert" style={styles.error}>{memberError}</Text>
              <Pressable accessibilityRole="button" onPress={() => setMemberRetry(value => value + 1)} style={{ minHeight: 44, justifyContent: 'center' }}><Text style={styles.description}>Retry member names</Text></Pressable></View>}
            {[true, false].map(online => {
              const members = roomMembers.filter(member => !!current?.connected_members?.includes(member) === online);
              if (!members.length) return null;
              return <View key={String(online)} style={{ gap: 6 }}>
                <Text style={styles.eyebrowDark}>{online ? 'ONLINE' : 'OFFLINE'} · {members.length}</Text>
                {members.map(member => {
                  const profile = memberProfiles[member];
                  const name = profile?.display_name?.trim() || profile?.username?.trim();
                  const label = member === session.user_id ? (name ? `${name} (You)` : 'You')
                    : name || `Player ${member.replace(/^user-/, '').slice(0, 6)}`;
                  return <Pressable key={member} accessibilityRole="button" onPress={() => { setRoomPanel(null); setSelectedMember({ user_id: member, display_name: name || label, username: profile?.username }); }} accessibilityLabel={`${label}, ${online ? 'Online' : 'Offline'}`} style={styles.member}>
                    <View style={styles.avatar}><Text style={styles.avatarText}>{label[0]}</Text>{online && <View style={{ position: 'absolute', bottom: -1, right: -1, width: 9, height: 9, borderRadius: 5, borderWidth: 2, borderColor: colors.surface, backgroundColor: colors.success }} />}</View>
                    <Text style={[styles.directoryName, !online && { color: colors.textMuted }]}>{label}</Text>
                    <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
                  </Pressable>;
                })}
              </View>;
            })}
          </>}
          {roomPanel === 'more' && <>
            <RoomShareActions roomId={room.room_id} menu />
            <Pressable accessibilityRole="button" accessibilityLabel="Ledger & settlements" onPress={() => setRoomPanel('ledger')} style={{ paddingVertical: 16 }}><View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}><Ionicons name="document-text-outline" size={24} color={colors.accent} /><View style={{ flex: 1, gap: 5 }}><Text style={styles.sectionTitle}>Ledger & settlements</Text><Text style={styles.description}>View game history, balances and settlements for this room.</Text></View><Ionicons name="chevron-forward" size={18} color={colors.textMuted} /></View></Pressable>
            {current?.creator_id === session?.user_id && <View style={styles.panel}>
              <Text style={styles.sectionTitle}>Room owner controls</Text>
              <Text style={styles.description}>You can delete this room after every active table has ended.</Text>
              {deleteConfirming ? <>
                <Text accessibilityRole="alert" style={styles.description}>Are you sure? This cannot be undone.</Text>
                <View style={styles.gameTabs}>
                  <Pressable accessibilityRole="button" onPress={() => setDeleteConfirming(false)} style={styles.gameTab}><Text style={styles.tabText}>Cancel</Text></Pressable>
                  <Pressable accessibilityRole="button" accessibilityLabel="Confirm delete room" onPress={() => { void shared.deleteRoom(); }} style={styles.dangerButton}><Text style={styles.dangerText}>Delete permanently</Text></Pressable>
                </View>
              </> : <Pressable accessibilityRole="button" accessibilityLabel="Delete room" onPress={() => setDeleteConfirming(true)} style={styles.dangerButton}><Text style={styles.dangerText}>Delete room</Text></Pressable>}
            </View>}
            {current?.creator_id !== session?.user_id && <View style={styles.panel}>
              <Text style={styles.sectionTitle}>Room membership</Text>
              <Text style={styles.description}>Leave this room to remove it from your rooms. You can join it again later if you still have access.</Text>
              <Pressable accessibilityRole="button" accessibilityLabel="Leave room membership" onPress={() => void leaveMembership()} style={styles.dangerButton}><Text style={styles.dangerText}>Leave room</Text></Pressable>
            </View>}
      {shared.leaveGameRequired && <View>
        <Text style={styles.subtitle}>{shared.abandonRequired ? 'Abandon the active match and leave the room? The match will stop for everyone.' : 'You are seated in a game. Leave the game and room? The game’s departure rules still apply.'}</Text>
        <Pressable accessibilityRole="button" disabled={busy} onPress={async () => {
          setBusy(true); try { await shared.leaveGameAndRoom(); } finally { setBusy(false); }
        }}><Text style={styles.subtitle}>{shared.abandonRequired ? 'Abandon match and leave room' : 'Leave game and room'}</Text></Pressable>
        <Pressable accessibilityRole="button" disabled={busy} onPress={shared.cancelLeave}><Text style={styles.subtitle}>Stay in room</Text></Pressable>
      </View>}
            {form === 'join' && !!(error || shared.error) && <Text accessibilityRole="alert" style={styles.error}>{error || shared.error}</Text>}
          </>}
          {roomPanel === 'ledger' && <RoomLedger roomId={room.room_id} session={session} embedded />}
        </RoomSheet>}
      </> : <>
        {session && !expired && <View style={styles.hero}>
          <Text accessibilityRole="header" style={[styles.title, !wide && styles.mobileTitle]}>Ready to play?</Text>
          <Text style={styles.subtitle}>Open a room or bring your players together.</Text>
          <View style={styles.quickActions}>
            <Pressable accessibilityRole="button" accessibilityLabel="Create room" onPress={() => { setLobbyTab('rooms'); setForm('create'); setRoomToolsOpen(true); }} style={styles.primaryAction}><Text style={styles.primaryActionText}>+ Create room</Text></Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Join with code" onPress={() => { setLobbyTab('rooms'); setForm('join'); setRoomToolsOpen(true); }} style={styles.secondaryAction}><Text style={styles.secondaryActionText}>Join with code</Text></Pressable>
          </View>
          <View accessibilityRole="tablist" style={styles.lobbyTabs}>
            {([['games', 'Active games'], ['rooms', 'Rooms'], ['players', 'Friends'], ['recent', 'Recent']] as const).map(([value, label]) => <Pressable key={value} accessibilityRole="tab" accessibilityState={{ selected: lobbyTab === value }} onPress={() => setLobbyTab(value)} style={[styles.lobbyTab, lobbyTab === value && styles.activeLobbyTab]}><Text style={[styles.lobbyTabText, lobbyTab === value && styles.activeLobbyTabText]}>{label}</Text></Pressable>)}
          </View>
        </View>}
        {!session && <View style={styles.panel}>
          <SocialSignInButtons disabled={shared.loggingIn} onBusyChange={shared.socialLoginBusy} onSession={shared.acceptSocialSession} />
          <Text style={styles.sectionTitle}>{authMode === 'signup' ? 'Create your account' : 'Welcome back'}</Text>
          <View style={styles.gameTabs}>
            {([['signin', 'Sign in'], ['signup', 'Sign up']] as const).map(([value, label]) =>
              <Pressable key={value} accessibilityRole="button" accessibilityState={{ selected: authMode === value }}
                onPress={() => { setAuthMode(value); setError(''); }} style={[styles.gameTab, authMode === value && styles.selectedTab]}>
                <Text style={[styles.tabText, authMode === value && styles.selectedTabText]}>{label}</Text>
              </Pressable>)}
          </View>
          <>
            <Text style={styles.subtitle}>{authMode === 'signup'
              ? 'Create an account so your identity and profile can follow you across sign-ins.'
              : 'Sign in with your Bhidne Ho username and password.'}</Text>
            {authMode === 'signup' && <>
              <Text style={styles.description}>Profile name (required) · the name other players see</Text>
              <FormInput accessibilityLabel="Profile name" aria-required placeholder="Your name or nickname" placeholderTextColor={colors.textMuted}
                value={profileName} onChangeText={value => setProfileName(Array.from(value).slice(0, 25).join(''))}
                returnKeyType="next" submitBehavior="submit" onSubmitEditing={() => usernameInput.current?.focus()} editable={!shared.loggingIn} autoCapitalize="words" textContentType="name" style={styles.input} />
            </>}
            <FormInput ref={usernameInput} returnKeyType="next" submitBehavior="submit" onSubmitEditing={() => passwordInput.current?.focus()} accessibilityLabel="Username" placeholder="Username" placeholderTextColor={colors.textMuted}
              value={username} onChangeText={setUsername} maxLength={32} editable={!shared.loggingIn}
              autoCapitalize="none" autoCorrect={false} textContentType="username" style={styles.input} />
            <FormInput ref={passwordInput} accessibilityLabel="Password" placeholder="Password" placeholderTextColor={colors.textMuted}
              value={password} onChangeText={setPassword} maxLength={128} editable={!shared.loggingIn}
              secureTextEntry textContentType={authMode === 'signup' ? 'newPassword' : 'password'} style={styles.input}
              returnKeyType="go" onSubmitEditing={() => {
                if (!missingProfileName && username.trim().length >= 3 && password.length >= 8) void shared.loginAccount(username, password, authMode === 'signup', profileName);
              }} />
            <Text style={styles.description}>Usernames use 3–32 letters, numbers, underscores, or hyphens. Passwords require at least 8 characters.</Text>

          </>
        </View>}
        {lobbyTab === 'rooms' && <View style={[styles.columns, !session && { marginTop: 24 }]}>
          {roomToolsOpen && <RoomSheet visible presentation="dialog" title={form === 'create' ? 'Create room' : 'Join with code'} closeLabel="Close room form" onClose={() => setRoomToolsOpen(false)}>
            {form === 'create' ? <>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <FormInput accessibilityLabel="Room name" value={name} onChangeText={setName} maxLength={60} placeholder="e.g. Friday friends" placeholderTextColor={colors.textMuted} style={[styles.input, { flex: 1, minWidth: 0 }]} editable={!busy} />
                <Pressable accessibilityRole="button" accessibilityLabel="Create room" disabled={!session || busy || expired || !name.trim()} accessibilityState={{ disabled: !session || busy || expired || !name.trim() }} onPress={createRoom} style={[styles.button, { backgroundColor: colors.primary }, (!session || busy || expired || !name.trim()) && styles.disabled]}><Text style={[styles.buttonText, { color: colors.onPrimary }]}>Create</Text></Pressable>
              </View>
              {!!(error || shared.error) && <Text accessibilityRole="alert" style={styles.error}>{error || shared.error}</Text>}
              <Pressable accessibilityRole="button" accessibilityState={{ expanded: roomOptionsOpen }} onPress={() => setRoomOptionsOpen(v => !v)} style={styles.textButton}><Text style={styles.enterText}>Privacy & invitations {roomOptionsOpen ? '−' : '+'}</Text></Pressable>
              {roomOptionsOpen && <>
              <Text style={styles.description}>Who can discover and enter this room?</Text>
              <View style={styles.gameTabs}>
                {([['public', 'Public'], ['friends', 'Friends only']] as const).map(([value, label]) =>
                  <Pressable key={value} accessibilityRole="button" accessibilityState={{ selected: visibility === value }}
                    onPress={() => setVisibility(value)} style={[styles.gameTab, visibility === value && styles.selectedTab]}>
                    <Text style={[styles.tabText, visibility === value && styles.selectedTabText]}>{label}</Text>
                  </Pressable>)}
              </View>
              <Text style={styles.description}>{visibility === 'friends' ? 'Only you and accepted friends can see or enter it, even with its code.' : 'Every signed-in player can see and enter it.'}</Text>
              <Text style={styles.sectionTitle}>Invite people (optional)</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><FormInput accessibilityLabel="Find people to invite to room" value={roomInviteQuery} onChangeText={setRoomInviteQuery} maxLength={64} placeholder="Name, username, or user ID" placeholderTextColor={colors.textMuted} autoCapitalize="none" autoCorrect={false} returnKeyType="search" onSubmitEditing={() => void searchRoomDirectory()} style={[styles.input, { flex: 1, minWidth: 0 }]} />
              <Pressable accessibilityRole="button" accessibilityLabel="Search directory" disabled={roomInviteSearching || roomInviteQuery.trim().length < 2} onPress={() => void searchRoomDirectory()} style={[styles.button, (roomInviteSearching || roomInviteQuery.trim().length < 2) && styles.disabled]}><Text style={styles.buttonText}>{roomInviteSearching ? '…' : 'Search'}</Text></Pressable></View>
              {!!roomInvitees.length && <View>{roomInvitees.map(player => <Pressable key={player.user_id} accessibilityRole="button" accessibilityLabel={`Remove ${player.display_name || player.username || player.user_id}`} onPress={() => setRoomInvitees(current => current.filter(item => item.user_id !== player.user_id))} style={styles.gameTab}><Text style={styles.tabText}>{player.display_name || player.username || player.user_id} · Remove</Text></Pressable>)}</View>}
              {!!roomInviteResults.length && <View>{roomInviteResults.filter(player => !roomInvitees.some(selected => selected.user_id === player.user_id)).map(player => <Pressable key={player.user_id} accessibilityRole="button" accessibilityLabel={`Invite ${player.display_name || player.username || player.user_id} to room`} onPress={() => setRoomInvitees(current => [...current, player])} style={styles.gameTab}><Text style={styles.directoryName}>{player.display_name || player.username || 'Player'}</Text><Text style={styles.description}>{player.username ? `@${player.username} · ` : ''}{player.user_id}</Text></Pressable>)}</View>}
              {!!roomInviteError && <Text accessibilityRole="alert" style={styles.error}>{roomInviteError}</Text>}
              </>}

            </> : <>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><FormInput accessibilityLabel="Room or table code" returnKeyType="go" onSubmitEditing={joinByCode} value={code} onChangeText={setCode} autoCapitalize="none" autoCorrect={false} maxLength={2048} placeholder="Room/table code or link" placeholderTextColor={colors.textMuted} style={[styles.input, { flex: 1, minWidth: 0 }]} editable={!busy} />
              <Pressable accessibilityRole="button" accessibilityLabel="Join room" disabled={!session || busy || expired || !code.trim()} accessibilityState={{ disabled: !session || busy || expired || !code.trim() }} onPress={joinByCode} style={[styles.button, { backgroundColor: colors.primary }, (!session || busy || expired) && styles.disabled]}><Text style={[styles.buttonText, { color: colors.onPrimary }]}>Join</Text></Pressable></View>
            </>}
            {form === 'join' && !!(error || shared.error) && <Text accessibilityRole="alert" style={styles.error}>{error || shared.error}</Text>}
            {busy && <Text accessibilityLiveRegion="polite" style={styles.description}>Entering room…</Text>}
          </RoomSheet>}
          {session && !expired && <>
            {shared.memberships.filter(m => m.active_game?.player_is_participant && m.active_game.status !== 'ended').map(m => {
              const target = rooms.find(r => r.room_id === m.room_id), active = m.active_game!;
              if (!target) return null;
              return <Pressable key={m.room_id} accessibilityRole="button" accessibilityLabel={`Return to table · ${target.name}`} onPress={() => { setLinkedMatch(active.game_id); enterRoom(target, active.game_type); }} style={styles.resumeCard}>
                <View style={{ flex: 1, gap: 4 }}><Text style={styles.eyebrow}>CONTINUE PLAYING</Text><Text style={styles.resumeTitle}>{({callbreak: 'Call Break', marriage: 'Marriage', flush: 'Flush'})[active.game_type]}</Text><Text style={styles.description}>{target.name}</Text></View>
                <Ionicons name="arrow-forward-circle" size={28} color={colors.accent} />
              </Pressable>;
            })}
            <Text accessibilityRole="header" style={styles.sectionTitle}>Your rooms</Text>
            {!enterRooms.length && <Text style={styles.description}>Create a room or join your friends to get started.</Text>}
<View style={styles.roomGrid}>{enterRooms.map(roomCard)}</View>
            {!!friendRooms.length && <Text accessibilityRole="header" style={styles.sectionTitle}>Friends’ rooms</Text>}
            <View style={styles.roomGrid}>{friendRooms.map(roomCard)}</View>
          </>}
        </View>}
        {session && !expired && lobbyTab === 'players' && <View style={styles.playersArea}>
          {!!friendRooms.length && <><Text accessibilityRole="header" style={styles.sectionTitle}>Friends’ rooms</Text><View style={styles.roomGrid}>{friendRooms.map(roomCard)}</View></>}
          <FriendsPanel session={session} />
        </View>}
        {session && !expired && lobbyTab === 'games' && !!(error || shared.error) && <Text accessibilityRole="alert" style={styles.error}>{error || shared.error}</Text>}
        {session && !expired && lobbyTab === 'games' && <ActiveGames session={session} busy={busy} enter={(table, action) => void enterActiveTable(table, action)} />}
        {session && !expired && lobbyTab === 'recent' && <View style={styles.columns}>
          <Text accessibilityRole="header" style={styles.sectionTitle}>Recently visited</Text>
          <Text style={styles.description}>Your recent rooms on this device.</Text>
          <View style={styles.roomGrid}>{recentRooms.map(roomCard)}</View>
          {!recentRooms.length && <View style={styles.panel}>
            <Ionicons name="time-outline" size={30} color={colors.accent} />
            <Text style={styles.description}>Rooms you visit will appear here. Explore your rooms to get started.</Text>
            <Pressable accessibilityRole="button" onPress={() => setLobbyTab('rooms')} style={styles.textButton}><Text style={styles.enterText}>Browse rooms →</Text></Pressable>
          </View>}
        </View>}
      </>}
    </View>
  </FormScrollView>
  {session && !expired && !room && !invitation && <LobbyNavigation selected={lobbyTab === 'players' ? 'friends' : lobbyTab === 'games' ? 'games' : 'home'}
    onSelect={tab => { if (tab === 'profile') setLobbyProfileOpen(true); else setLobbyTab(tab === 'home' ? 'rooms' : tab === 'friends' ? 'players' : 'games'); }} />}
  {session && lobbyProfileOpen && <Modal visible animationType="slide" onRequestClose={() => setLobbyProfileOpen(false)}>
    <ProfileScreen session={session} personal={personal} onBack={() => setLobbyProfileOpen(false)} onSignOut={() => { setLobbyProfileOpen(false); signOut(); }} />
  </Modal>}
  {!session && <FormFooter>
            {!!shared.error && <Text accessibilityRole="alert" style={styles.error}>{shared.error}</Text>}
            <Pressable accessibilityRole="button" disabled={missingProfileName || username.trim().length < 3 || password.length < 8 || shared.loggingIn}
              onPress={() => void shared.loginAccount(username, password, authMode === 'signup', profileName)}
              style={[styles.button, { backgroundColor: colors.primary }, (missingProfileName || username.trim().length < 3 || password.length < 8 || shared.loggingIn) && styles.disabled]}>
              <Text style={[styles.buttonText, { color: colors.onPrimary }]}>{shared.loggingIn ? 'Please wait…' : authMode === 'signup' ? 'Create account' : 'Sign in'}</Text>
            </Pressable></FormFooter>}{room && !expired && !invitation && !gameOpen && chat.view}</KeyboardFrame></HeaderProfileContext.Provider>;
}
const createStyles = (colors: ThemeColors) => StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background }, container: { alignItems: 'center', paddingHorizontal: 16 }, content: { width: '100%', maxWidth: 1120 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  roomMasthead: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 14, paddingVertical: 20, borderBottomWidth: 1, borderColor: colors.border },
  roomIdentity: { flex: 1, minWidth: 0, gap: 5 }, roomTitle: { fontFamily: fonts.display, fontSize: 36, lineHeight: 42, color: colors.text }, mobileRoomTitle: { fontSize: 27, lineHeight: 33 },
  roomActions: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  header: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 16, borderBottomWidth: 1, borderColor: colors.border, paddingBottom: 18 },
  brand: { fontFamily: fonts.body, fontSize: 26, color: colors.accent }, textButton: { minHeight: 44, justifyContent: 'center' }, lightText: { fontFamily: fonts.medium, fontSize: 12, color: colors.accent },
  hero: { paddingTop: 24, paddingBottom: 20, gap: 8 }, eyebrow: { fontFamily: fonts.medium, fontSize: 9, letterSpacing: 2, color: colors.accent }, title: { fontFamily: fonts.editorial, fontSize: 44, lineHeight: 48, color: colors.text }, mobileTitle: { fontSize: 43, lineHeight: 46 }, subtitle: { fontFamily: fonts.body, fontSize: 13, lineHeight: 23, color: colors.textMuted },
  quickActions: { flexDirection: 'row', gap: 10, marginTop: 8 }, primaryAction: { flex: 1, minHeight: 54, borderRadius: 14, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14 }, primaryActionText: { fontFamily: fonts.medium, fontSize: 13, color: colors.onPrimary }, secondaryAction: { flex: 1, minHeight: 54, borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14 }, secondaryActionText: { fontFamily: fonts.medium, fontSize: 13, color: colors.text },
  lobbyTabs: { backgroundColor: colors.surface, borderTopLeftRadius: 18, borderTopRightRadius: 18, flexDirection: 'row', borderBottomWidth: 1, borderColor: colors.borderSubtle, marginTop: 14 }, lobbyTab: { flex: 1, alignItems: 'center', minHeight: 48, paddingHorizontal: 6, justifyContent: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent' }, activeLobbyTab: { borderBottomColor: colors.accent }, lobbyTabText: { textAlign: 'center', fontFamily: fonts.medium, fontSize: 13, color: colors.textMuted }, activeLobbyTabText: { color: colors.accent }, playersArea: { marginTop: 4, gap: 14 },
  sectionToggle: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }, sectionTitle: { fontFamily: fonts.medium, fontSize: 16, color: colors.text },
  resumeCard: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, backgroundColor: colors.surfaceSelected, borderRadius: 14 },
  resumeTitle: { fontFamily: fonts.medium, fontSize: 16, color: colors.text },
  roomGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 14 },
  columns: { gap: 14 }, wideColumns: { flexDirection: 'row', alignItems: 'flex-start' }, sideColumn: { gap: 18 }, fixedSide: { width: 330 }, mainColumn: { flex: 1, minWidth: 0 },
  panel: { backgroundColor: colors.surface, borderRadius: 16, padding: 24, gap: 8 }, heading: { fontFamily: fonts.display, fontSize: 27, color: colors.text }, description: { fontFamily: fonts.body, fontSize: 12, lineHeight: 21, color: colors.textMuted },
  gameTabs: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 14 }, gameTab: { minHeight: 44, paddingHorizontal: 12, paddingVertical: 8, gap: 6, alignItems: 'center', justifyContent: 'center', borderRadius: 8, backgroundColor: colors.surface }, selectedTab: { backgroundColor: colors.surfaceSelected }, tabText: { fontFamily: fonts.medium, fontSize: 12, color: colors.textMuted }, selectedTabText: { color: colors.text }, eyebrowDark: { fontFamily: fonts.medium, fontSize: 9, letterSpacing: 2, color: colors.accent }, gameTitle: { fontFamily: fonts.display, fontSize: 30, color: colors.text },
  codeBox: { backgroundColor: colors.surface, borderRadius: 10, padding: 16, marginVertical: 10, gap: 8 }, codeLabel: { fontFamily: fonts.medium, color: colors.accent, fontSize: 9, letterSpacing: 2 }, code: { fontFamily: fonts.medium, fontSize: 22, letterSpacing: 1, color: colors.text },
  member: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, minHeight: 52 }, avatar: { width: 30, height: 30, borderRadius: 15, backgroundColor: colors.surfaceRaised, alignItems: 'center', justifyContent: 'center' }, avatarText: { fontFamily: fonts.medium, fontSize: 11, color: colors.accent }, online: { fontFamily: fonts.body, fontSize: 10, color: colors.textMuted, marginLeft: 'auto' },
  input: { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, borderRadius: 8, minHeight: 48, padding: 14, fontFamily: fonts.body, color: colors.text, marginVertical: 10 },
  button: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, minHeight: 48, borderRadius: 8, alignItems: 'center', justifyContent: 'center', padding: 12 }, buttonText: { fontFamily: fonts.medium, color: colors.text, fontSize: 12 }, disabled: { opacity: 0.5 },
  dangerButton: { minHeight: 48, borderRadius: 8, borderWidth: 1, borderColor: colors.danger, alignItems: 'center', justifyContent: 'center', padding: 12 }, dangerText: { fontFamily: fonts.medium, color: colors.danger, fontSize: 12 },
  availableRooms: { maxHeight: 420 }, roomRow: { flexDirection: 'row', gap: 12, alignItems: 'center', borderBottomWidth: 1, borderColor: colors.border, paddingVertical: 18 }, directoryName: { fontFamily: fonts.medium, fontSize: 14, color: colors.text, flexShrink: 1 }, enterButton: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 8 }, enterText: { fontFamily: fonts.medium, fontSize: 12, color: colors.accent },
  roomRowActions: { alignItems: 'stretch', gap: 4, minWidth: 86 }, rowDangerButton: { minHeight: 40, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 8 },
  comingSoon: { paddingVertical: 24, gap: 10 }, footer: { fontFamily: fonts.body, fontSize: 10, color: colors.textMuted, marginVertical: 24, textAlign: 'center' }, error: { color: colors.danger, fontFamily: fonts.body, fontSize: 12, lineHeight: 20, marginVertical: 12 },
});
