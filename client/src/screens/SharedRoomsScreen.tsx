import { useRoomChat } from '../components/RoomChat';
import { InvitationPreview } from '../components/InvitationPreview';
import { ShareLink } from '../components/ShareLink';
import type { Invitation } from '../multiplayer/invitations';
import { AppHeader, HeaderProfileContext } from '../components/AppHeader';
import { HeaderAction } from '../components/HeaderAction';
import { NotificationBell } from '../components/NotificationBell';
import { GameIcon } from '../components/BrandArt';
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CallBreakTableScreen } from './CallBreakTableScreen';
import { fonts, useTheme, useThemedStyles, type ThemeColors } from '../theme';
import { ProfileScreen } from './ProfileScreen';
import { usePlayerPhrases } from '../multiplayer/usePlayerPhrases';
import { RoomGameControl } from '../components/RoomGameControl';
import { FriendsPanel } from '../components/FriendsPanel';
import { RoomLedger } from '../components/RoomLedger';

import { apiUrl, request } from '../multiplayer/api';
import type { Room } from '../multiplayer/session';
import { useRoomSession } from '../multiplayer/useRoomSession';

export function SharedRoomsScreen({ onExit, invitation, dismissInvitation }: { onExit: () => void; invitation?: Invitation | null; dismissInvitation?: () => void }) {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const insets = useSafeAreaInsets();
  const wide = useWindowDimensions().width >= 900;
  const [roomToolsOpen, setRoomToolsOpen] = useState(false);
  const [roomsOpen, setRoomsOpen] = useState(false);
  const [lobbyTab, setLobbyTab] = useState<'rooms' | 'players'>('rooms');
  const [inviteOpen, setInviteOpen] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);
  const [form, setForm] = useState<'create' | 'join'>('create');
  const [testingOpen, setTestingOpen] = useState(false);
  const [preview, setPreview] = useState(false);
  const [previewSize, setPreviewSize] = useState<4 | 5>(4);
  const [linkedMatch, setLinkedMatch] = useState<string>();
  const [authMode, setAuthMode] = useState<'signin' | 'signup'>('signin');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const shared = useRoomSession();
  const { session, rooms, room, game, setGame, expired } = shared;
  const [gameOpen, setGameOpen] = useState(false);
  const chat = useRoomChat({ roomId: room?.room_id || '', session: session || { token: '', user_id: '' }, connected: !!room && !!session && !expired && !gameOpen && shared.status === 'connected' });
  useEffect(() => {
    setInviteOpen(false); setMembersOpen(false);
  }, [room?.room_id]);
  const personal = usePlayerPhrases(session, !!session && !expired);
  const [name, setName] = useState('');
  const [visibility, setVisibility] = useState<'public' | 'friends'>('public');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [deleteConfirming, setDeleteConfirming] = useState(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  async function leaveRoom() {
    if (!await shared.leaveRoom()) return; setRoomToolsOpen(false); setRoomsOpen(false); setPreview(false); setTestingOpen(false); setError('');
  }
  function joinRoom(target: Room) {
    shared.joinRoom(target); setPreview(false); setTestingOpen(false); setError('');
  }
  function signOut() { void shared.signOut(); onExit(); }
  async function createRoom() {
    if (!session || busy || expired) return;
    if (!name.trim()) { setError('Enter a room name.'); return; }
    setBusy(true); setError('');
    try {
      const created = await request<Room>('/rooms', session, { name: name.trim(), visibility });
      if (!mounted.current) return;
      setName(''); joinRoom(created);
    } catch (error) { if (mounted.current) setError(error instanceof Error ? error.message : 'Could not create room.'); }
    finally { if (mounted.current) setBusy(false); }
  }
  const current = rooms.find(item => item.room_id === room?.room_id) || room;
  const availableRooms = rooms.filter(item => item.feed_source === 'you' || item.feed_source === 'joined' || item.feed_source === 'friend');
  const ownsCurrentRoom = !!current && current.creator_id === session?.user_id;
  const roomMembers = [...new Set([...(current?.members || []), ...(room && session && shared.status === 'connected' ? [session.user_id] : [])])];
  if (room && preview) return <CallBreakTableScreen capacity={previewSize} names={['You']} tableName={room.name} onBack={() => setPreview(false)} />;
  const selectedGame = game === 'flush' || game === 'marriage' ? game : 'callbreak';
  return <HeaderProfileContext.Provider value={session && !expired ? close => <ProfileScreen session={session} personal={personal} onBack={close} onSignOut={signOut} /> : null}><View style={{ flex: 1 }}><ScrollView style={styles.page} contentContainerStyle={[styles.container, {
    paddingTop: Math.max(insets.top, 24), paddingBottom: Math.max(insets.bottom, 28) + (room ? 64 : 0),
  }]}>
    <View style={styles.content}>
      <AppHeader inlineActions={session && !expired ? <NotificationBell session={session} /> : null} />
      {!!(error || shared.error) && <Text accessibilityRole="alert" style={styles.error}>{error || shared.error}</Text>}
      {shared.leaveGameRequired && <View>
        <Text style={styles.subtitle}>{shared.abandonRequired ? 'Abandon the active match and leave the room? The match will stop for everyone.' : 'You are seated in a game. Leave the game and room? The game’s departure rules still apply.'}</Text>
        <Pressable accessibilityRole="button" disabled={busy} onPress={async () => {
          setBusy(true); try { await shared.leaveGameAndRoom(); } finally { setBusy(false); }
        }}><Text style={styles.subtitle}>{shared.abandonRequired ? 'Abandon match and leave room' : 'Leave game and room'}</Text></Pressable>
        <Pressable accessibilityRole="button" disabled={busy} onPress={shared.cancelLeave}><Text style={styles.subtitle}>Stay in room</Text></Pressable>
      </View>}
      {room && !expired && shared.status !== 'connected'  && <Text accessibilityLiveRegion="polite" style={styles.subtitle}>Reconnecting to your room…</Text>}
      {invitation && session ? <InvitationPreview key={`${invitation.roomId}:${invitation.matchId}`} invitation={invitation} session={session}
        dismiss={() => dismissInvitation?.()} join={async (target, gameType, matchId) => {
          const joined = await shared.joinRoom(target, gameType);
          if (joined) { setLinkedMatch(matchId); dismissInvitation?.(); }
          return joined;
        }} /> : room ? <>
        <View style={styles.roomMasthead}>
          <View style={styles.roomIdentity}>
            <Text accessibilityRole="header" style={[styles.roomTitle, !wide && styles.mobileRoomTitle]}>{room.name}</Text>
            <Text style={styles.subtitle}>{roomMembers.length} {roomMembers.length === 1 ? 'player' : 'players'} · Invite friends to take a seat.</Text>
          </View>
          <View style={styles.roomActions}>
            <HeaderAction icon="leave" label="Back to lobby" onPress={leaveRoom} />
            <ShareLink roomId={room.room_id} />
          </View>
        </View>
        <View style={[styles.columns, wide && styles.wideColumns]}>
          <View style={styles.mainColumn}>
            {session && <RoomLedger roomId={room.room_id} session={session} />}
            {session && <RoomGameControl onOpenChange={setGameOpen} requestedMatchId={linkedMatch} personal={personal} key={room.room_id} roomId={room.room_id} apiUrl={apiUrl} token={session.token} userId={session.user_id} pokes={shared.pokes} connected={shared.status === 'connected' && !expired} members={current?.connected_members || []} roomMembers={roomMembers} connectionMessage={expired ? shared.error : undefined}
              gameType={selectedGame} createContent={<>
            <Text style={styles.eyebrowDark}>CHOOSE A GAME</Text>
            <View style={styles.gameTabs}>
              {(['callbreak', 'flush', 'marriage'] as const).map(value => <Pressable key={value} accessibilityRole="button"
                accessibilityLabel={`Enter ${value === 'callbreak' ? 'Call Break' : value === 'flush' ? 'Flush' : 'Marriage'} game room`}
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
          <View style={[styles.sideColumn, wide && styles.fixedSide]}>
            <View style={styles.panel}>
              <Pressable accessibilityRole="button" accessibilityLabel="Invite a friend" aria-expanded={inviteOpen} accessibilityState={{ expanded: inviteOpen }} onPress={() => setInviteOpen(value => !value)} style={styles.sectionToggle}>
                <Text style={styles.sectionTitle}>Invite a friend</Text><Text style={styles.sectionTitle}>{inviteOpen ? '-' : '+'}</Text>
              </Pressable>
              {inviteOpen && <View>
              <Text style={styles.description}>Share this table code to bring everyone into the same room.</Text>
              <View style={styles.codeBox}><Text style={styles.codeLabel}>TABLE CODE</Text><Text selectable accessibilityLabel={`Table code ${room.room_id}`} style={styles.code}>{room.room_id}</Text></View>
              <Text style={styles.description}>Friends enter the code on the room list, then take a seat to play.</Text>
              </View>}
            </View>
            {room.creator_id === session?.user_id && <View style={styles.panel}>
              <Text style={styles.sectionTitle}>Room owner controls</Text>
              <Text style={styles.description}>Deleting closes this room and all of its active tables for everyone.</Text>
              {deleteConfirming ? <>
                <Text accessibilityRole="alert" style={styles.description}>Are you sure? This cannot be undone.</Text>
                <View style={styles.gameTabs}>
                  <Pressable accessibilityRole="button" onPress={() => setDeleteConfirming(false)} style={styles.gameTab}><Text style={styles.tabText}>Cancel</Text></Pressable>
                  <Pressable accessibilityRole="button" accessibilityLabel="Confirm delete room" onPress={() => { void shared.deleteRoom(); }} style={styles.dangerButton}><Text style={styles.dangerText}>Delete permanently</Text></Pressable>
                </View>
              </> : <Pressable accessibilityRole="button" accessibilityLabel="Delete room" onPress={() => setDeleteConfirming(true)} style={styles.dangerButton}><Text style={styles.dangerText}>Delete room</Text></Pressable>}
            </View>}
            <View style={styles.panel}>
              <Pressable accessibilityRole="button" accessibilityLabel="Currently in the room" aria-expanded={membersOpen} accessibilityState={{ expanded: membersOpen }} onPress={() => setMembersOpen(value => !value)} style={styles.sectionToggle}>
                <Text style={styles.sectionTitle}>Currently in the room · {roomMembers.length}</Text><Text style={styles.sectionTitle}>{membersOpen ? '-' : '+'}</Text>
              </Pressable>
              {membersOpen && roomMembers.map((member, index) => <View key={member} style={styles.member}>
                <View style={styles.avatar}><Text style={styles.avatarText}>{member === session?.user_id ? 'Y' : String(index + 1)}</Text></View>
                <Text style={styles.directoryName}>{member === session?.user_id ? 'You' : `Guest ${index + 1}`}</Text>
                <Text style={styles.online}>{current?.connected_members?.includes(member) ? 'Online' : 'Offline'}</Text>
              </View>)}
            </View>
          </View>
        </View>
        <View style={styles.testing}>
          <Pressable accessibilityRole="button" accessibilityState={{ expanded: testingOpen }} onPress={() => setTestingOpen(value => !value)} style={styles.testingToggle}>
            <Text style={styles.lightText}>Developer previews</Text><Text style={styles.lightText}>{testingOpen ? '−' : '+'}</Text>
          </Pressable>
          {testingOpen && <View style={styles.testingBody}>
            <Text style={styles.subtitle}>Local player row and card layout previews.</Text>
            <View style={styles.gameTabs}>{([4, 5] as const).map(size => <Pressable key={size} accessibilityRole="button" accessibilityState={{ selected: previewSize === size }} onPress={() => setPreviewSize(size)} style={[styles.gameTab, previewSize === size && styles.selectedTab]}><Text style={[styles.tabText, previewSize === size && styles.selectedTabText]}>{size} players</Text></Pressable>)}</View>
            <Pressable accessibilityRole="button" onPress={() => setPreview(true)} style={styles.button}><Text style={styles.buttonText}>Preview card table</Text></Pressable>
          </View>}
        </View>
      </> : <>
        {session && !expired && <View style={styles.hero}>
          <Text style={styles.eyebrow}>YOUR LOBBY</Text>
          <Text accessibilityRole="header" style={[styles.title, !wide && styles.mobileTitle]}>Ready to play?</Text>
          <Text style={styles.subtitle}>Open a room or bring your players together.</Text>
          <View style={styles.quickActions}>
            <Pressable accessibilityRole="button" accessibilityLabel="Create room" onPress={() => { setLobbyTab('rooms'); setForm('create'); setRoomToolsOpen(true); }} style={styles.primaryAction}><Text style={styles.primaryActionText}>+ Create room</Text></Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Join with code" onPress={() => { setLobbyTab('rooms'); setForm('join'); setRoomToolsOpen(true); }} style={styles.secondaryAction}><Text style={styles.secondaryActionText}>Join with code</Text></Pressable>
          </View>
          <View accessibilityRole="tablist" style={styles.lobbyTabs}>
            {([['rooms', 'Rooms'], ['players', 'Players']] as const).map(([value, label]) => <Pressable key={value} accessibilityRole="tab" accessibilityState={{ selected: lobbyTab === value }} onPress={() => setLobbyTab(value)} style={[styles.lobbyTab, lobbyTab === value && styles.activeLobbyTab]}><Text style={[styles.lobbyTabText, lobbyTab === value && styles.activeLobbyTabText]}>{label}</Text></Pressable>)}
          </View>
        </View>}
        {!session && <View style={styles.panel}>
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
            <TextInput accessibilityLabel="Username" placeholder="Username" placeholderTextColor={colors.textMuted}
              value={username} onChangeText={setUsername} maxLength={32} editable={!shared.loggingIn}
              autoCapitalize="none" autoCorrect={false} textContentType="username" style={styles.input} />
            <TextInput accessibilityLabel="Password" placeholder="Password" placeholderTextColor={colors.textMuted}
              value={password} onChangeText={setPassword} maxLength={128} editable={!shared.loggingIn}
              secureTextEntry textContentType={authMode === 'signup' ? 'newPassword' : 'password'} style={styles.input}
              returnKeyType="go" onSubmitEditing={() => {
                if (username.trim().length >= 3 && password.length >= 8) void shared.loginAccount(username, password, authMode === 'signup');
              }} />
            <Text style={styles.description}>Usernames use 3–32 letters, numbers, underscores, or hyphens. Passwords require at least 8 characters.</Text>
            <Pressable accessibilityRole="button" disabled={username.trim().length < 3 || password.length < 8 || shared.loggingIn}
              onPress={() => void shared.loginAccount(username, password, authMode === 'signup')}
              style={[styles.button, (username.trim().length < 3 || password.length < 8 || shared.loggingIn) && styles.disabled]}>
              <Text style={styles.buttonText}>{shared.loggingIn ? 'Please wait…' : authMode === 'signup' ? 'Create account' : 'Sign in'}</Text>
            </Pressable>
          </>
          {!!shared.error && <Text accessibilityRole="alert" style={styles.subtitle}>{shared.error}</Text>}
        </View>}
        {lobbyTab === 'rooms' && <View style={[styles.columns, !session && { marginTop: 24 }]}>
          {roomToolsOpen && <View style={styles.panel}>
            <View style={styles.gameTabs}>
              <Pressable accessibilityRole="button" accessibilityState={{ selected: form === 'create' }} onPress={() => setForm('create')} style={[styles.gameTab, form === 'create' && styles.selectedTab]}><Text style={[styles.tabText, form === 'create' && styles.selectedTabText]}>Create room</Text></Pressable>
              <Pressable accessibilityRole="button" accessibilityState={{ selected: form === 'join' }} onPress={() => setForm('join')} style={[styles.gameTab, form === 'join' && styles.selectedTab]}><Text style={[styles.tabText, form === 'join' && styles.selectedTabText]}>Join with code</Text></Pressable>
            </View>
            {form === 'create' ? <>
              <TextInput accessibilityLabel="Room name" value={name} onChangeText={setName} maxLength={60} placeholder="e.g. Friday friends" placeholderTextColor={colors.textMuted} style={styles.input} editable={!busy} />
              <Text style={styles.description}>Who can discover and enter this room?</Text>
              <View style={styles.gameTabs}>
                {([['public', 'Public'], ['friends', 'Friends only']] as const).map(([value, label]) =>
                  <Pressable key={value} accessibilityRole="button" accessibilityState={{ selected: visibility === value }}
                    onPress={() => setVisibility(value)} style={[styles.gameTab, visibility === value && styles.selectedTab]}>
                    <Text style={[styles.tabText, visibility === value && styles.selectedTabText]}>{label}</Text>
                  </Pressable>)}
              </View>
              <Text style={styles.description}>{visibility === 'friends' ? 'Only you and accepted friends can see or enter it, even with its code.' : 'Every signed-in player can see and enter it.'}</Text>
              <Pressable accessibilityRole="button" disabled={!session || busy || expired} accessibilityState={{ disabled: !session || busy || expired }} onPress={createRoom} style={[styles.button, (!session || busy || expired) && styles.disabled]}><Text style={styles.buttonText}>Create and enter room</Text></Pressable>
            </> : <>
              <TextInput accessibilityLabel="Table code / room ID" value={code} onChangeText={setCode} autoCapitalize="none" autoCorrect={false} maxLength={64} placeholder="Paste a table code" placeholderTextColor={colors.textMuted} style={styles.input} editable={!busy} />
              <Pressable accessibilityRole="button" disabled={!session || busy || expired} accessibilityState={{ disabled: !session || busy || expired }} onPress={() => {
                const target = rooms.find(item => item.room_id === code.trim());
                if (code.trim()) joinRoom(target || { room_id: code.trim(), name: 'Joined room', members: [] });
                else setError('Enter a table code.');
              }} style={[styles.button, (!session || busy || expired) && styles.disabled]}><Text style={styles.buttonText}>Enter with table code</Text></Pressable>
            </>}
            {busy && <Text accessibilityLiveRegion="polite" style={styles.description}>Entering room…</Text>}
          </View>}
          <View style={styles.panel}>
            <Pressable accessibilityRole="button" accessibilityLabel="Available rooms" aria-expanded={roomsOpen} accessibilityState={{ expanded: roomsOpen }} onPress={() => setRoomsOpen(value => !value)} style={styles.sectionToggle}>
              <Text style={styles.sectionTitle}>Available rooms · {availableRooms.length}</Text><Text style={styles.sectionTitle}>{roomsOpen ? '-' : '+'}</Text>
            </Pressable>
            {roomsOpen && <View>
            {session && !availableRooms.length && <View style={styles.comingSoon}><Text style={styles.heading}>No available rooms yet.</Text><Text style={styles.description}>Create a room or join one with a code to keep it here.</Text></View>}
            <ScrollView nestedScrollEnabled style={styles.availableRooms} contentContainerStyle={{ gap: 8 }}>
            {availableRooms.map(item => <View key={item.room_id} style={styles.roomRow}>
              <View style={{ flex: 1 }}><Text style={styles.directoryName}>{item.name}</Text><Text style={styles.description}>{item.feed_source === 'you' ? 'Created by you' : item.feed_source === 'joined' ? 'Joined room' : "Friend's room"} · {item.visibility === 'friends' ? 'Friends only' : 'Public'}</Text><Text selectable style={styles.description}>Table code: {item.room_id}</Text><Text style={styles.description}>{item.members.length} members · {item.connected_members?.length || 0} online</Text></View>
              <Pressable accessibilityRole="button" accessibilityLabel={`Enter ${item.name}`} disabled={busy} accessibilityState={{ disabled: busy }} onPress={() => joinRoom(item)} style={[styles.enterButton, busy && styles.disabled]}><Text style={styles.enterText}>Enter →</Text></Pressable>
            </View>)}
            </ScrollView>
            </View>}
          </View>
        </View>}
        {session && !expired && lobbyTab === 'players' && <View style={styles.playersArea}><FriendsPanel session={session} /></View>}
      </>}
    </View>
  </ScrollView>{room && !expired && !invitation && !gameOpen && chat}</View></HeaderProfileContext.Provider>;
}
const createStyles = (colors: ThemeColors) => StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background }, container: { alignItems: 'center', paddingHorizontal: 20 }, content: { width: '100%', maxWidth: 1120 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  roomMasthead: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 14, paddingVertical: 20, borderBottomWidth: 1, borderColor: colors.border },
  roomIdentity: { flex: 1, minWidth: 210, gap: 5 }, roomTitle: { fontFamily: fonts.display, fontSize: 36, lineHeight: 42, color: colors.text }, mobileRoomTitle: { fontSize: 27, lineHeight: 33 },
  roomActions: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  header: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 16, borderBottomWidth: 1, borderColor: colors.border, paddingBottom: 18 },
  brand: { fontFamily: fonts.body, fontSize: 26, color: colors.accent }, textButton: { minHeight: 44, justifyContent: 'center' }, lightText: { fontFamily: fonts.medium, fontSize: 12, color: colors.accent },
  hero: { paddingVertical: 32, gap: 10 }, eyebrow: { fontFamily: fonts.medium, fontSize: 9, letterSpacing: 2, color: colors.accent }, title: { fontFamily: fonts.display, fontSize: 52, color: colors.text }, mobileTitle: { fontSize: 38 }, subtitle: { fontFamily: fonts.body, fontSize: 13, lineHeight: 23, color: colors.textMuted },
  quickActions: { flexDirection: 'row', gap: 10, marginTop: 8 }, primaryAction: { flex: 1, minHeight: 48, borderRadius: 10, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14 }, primaryActionText: { fontFamily: fonts.medium, fontSize: 13, color: colors.onPrimary }, secondaryAction: { flex: 1, minHeight: 48, borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14 }, secondaryActionText: { fontFamily: fonts.medium, fontSize: 13, color: colors.text },
  lobbyTabs: { flexDirection: 'row', borderBottomWidth: 1, borderColor: colors.border, marginTop: 12 }, lobbyTab: { minHeight: 46, paddingHorizontal: 20, justifyContent: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent' }, activeLobbyTab: { borderBottomColor: colors.accent }, lobbyTabText: { fontFamily: fonts.medium, fontSize: 13, color: colors.textMuted }, activeLobbyTabText: { color: colors.text }, playersArea: { marginTop: 4 },
  sectionToggle: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }, sectionTitle: { fontFamily: fonts.medium, fontSize: 14, color: colors.text },
  columns: { gap: 20 }, wideColumns: { flexDirection: 'row', alignItems: 'flex-start' }, sideColumn: { gap: 18 }, fixedSide: { width: 330 }, mainColumn: { flex: 1, minWidth: 0 },
  panel: { backgroundColor: colors.surface, borderRadius: 16, padding: 24, gap: 8 }, heading: { fontFamily: fonts.display, fontSize: 27, color: colors.text }, description: { fontFamily: fonts.body, fontSize: 12, lineHeight: 21, color: colors.textMuted },
  gameTabs: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 14 }, gameTab: { minHeight: 44, paddingHorizontal: 12, paddingVertical: 8, gap: 6, alignItems: 'center', justifyContent: 'center', borderRadius: 8, backgroundColor: colors.surface }, selectedTab: { backgroundColor: colors.surfaceSelected }, tabText: { fontFamily: fonts.medium, fontSize: 12, color: colors.textMuted }, selectedTabText: { color: colors.text }, eyebrowDark: { fontFamily: fonts.medium, fontSize: 9, letterSpacing: 2, color: colors.accent }, gameTitle: { fontFamily: fonts.display, fontSize: 34, color: colors.text },
  codeBox: { backgroundColor: colors.surface, borderRadius: 10, padding: 16, marginVertical: 10, gap: 8 }, codeLabel: { fontFamily: fonts.medium, color: colors.accent, fontSize: 9, letterSpacing: 2 }, code: { fontFamily: fonts.medium, fontSize: 22, letterSpacing: 1, color: colors.text },
  member: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 }, avatar: { width: 30, height: 30, borderRadius: 15, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' }, avatarText: { fontFamily: fonts.medium, fontSize: 11, color: colors.accent }, online: { fontFamily: fonts.body, fontSize: 10, color: colors.textMuted, marginLeft: 'auto' },
  input: { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, borderRadius: 8, minHeight: 48, padding: 14, fontFamily: fonts.body, color: colors.text, marginVertical: 10 },
  button: { backgroundColor: colors.surfaceSelected, minHeight: 48, borderRadius: 8, alignItems: 'center', justifyContent: 'center', padding: 12 }, buttonText: { fontFamily: fonts.medium, color: colors.text, fontSize: 12 }, disabled: { opacity: 0.5 },
  dangerButton: { minHeight: 48, borderRadius: 8, borderWidth: 1, borderColor: colors.danger, alignItems: 'center', justifyContent: 'center', padding: 12 }, dangerText: { fontFamily: fonts.medium, color: colors.danger, fontSize: 12 },
  availableRooms: { maxHeight: 420 }, roomRow: { flexDirection: 'row', gap: 12, alignItems: 'center', borderBottomWidth: 1, borderColor: colors.border, paddingVertical: 18 }, directoryName: { fontFamily: fonts.medium, fontSize: 14, color: colors.text, flexShrink: 1 }, enterButton: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 8 }, enterText: { fontFamily: fonts.medium, fontSize: 12, color: colors.accent },
  testing: { marginTop: 24, borderTopWidth: 1, borderColor: colors.border }, testingToggle: { minHeight: 54, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, testingBody: { gap: 16, paddingBottom: 20 },
  comingSoon: { paddingVertical: 24, gap: 10 }, footer: { fontFamily: fonts.body, fontSize: 10, color: colors.textMuted, marginVertical: 24, textAlign: 'center' }, error: { color: colors.danger, fontFamily: fonts.body, fontSize: 12, lineHeight: 20, marginVertical: 12 },
});
