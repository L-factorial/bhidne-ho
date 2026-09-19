import { RoomCard } from '../components/RoomCard';
import { useRoomChat } from '../components/RoomChat';
import { InvitationPreview } from '../components/InvitationPreview';
import { CopyRoomCode, ShareLink } from '../components/ShareLink';
import type { Invitation } from '../multiplayer/invitations';
import { AppHeader, HeaderProfileContext } from '../components/AppHeader';
import { HeaderAction } from '../components/HeaderAction';
import { NotificationBell } from '../components/NotificationBell';
import { GameIcon } from '../components/BrandArt';
import { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
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

type InvitePlayer = { user_id: string; display_name: string; username?: string | null };

export function SharedRoomsScreen({ onExit, invitation, dismissInvitation }: { onExit: () => void; invitation?: Invitation | null; dismissInvitation?: () => void }) {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const insets = useSafeAreaInsets();
  const wide = useWindowDimensions().width >= 900;
  const [roomToolsOpen, setRoomToolsOpen] = useState(false);
  const [roomOptionsOpen, setRoomOptionsOpen] = useState(false);
  const [lobbyTab, setLobbyTab] = useState<'rooms' | 'players'>('rooms');
  const [inviteOpen, setInviteOpen] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);
  const [form, setForm] = useState<'create' | 'join'>('create');
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
  const [roomInviteQuery, setRoomInviteQuery] = useState('');
  const [roomInviteResults, setRoomInviteResults] = useState<InvitePlayer[]>([]);
  const [roomInvitees, setRoomInvitees] = useState<InvitePlayer[]>([]);
  const [roomInviteError, setRoomInviteError] = useState('');
  const [roomInviteSearching, setRoomInviteSearching] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [deleteConfirming, setDeleteConfirming] = useState(false);

  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  async function leaveMembership() {
    if (!await shared.leaveRoom()) return; setRoomToolsOpen(false); setError('');
  }
  function joinRoom(target: Room, targetGame?: 'callbreak' | 'marriage' | 'flush') {
    if (busy) return;
    setBusy(true); setLinkedMatch(undefined); setError('');
    void shared.joinRoom(target, targetGame).then(ok => { if (ok) setRoomToolsOpen(false); }).finally(() => setBusy(false));
  }
  function enterRoom(target: Room, targetGame?: 'callbreak' | 'marriage' | 'flush') {
    setRoomToolsOpen(false); shared.enterRoom(target, targetGame); setError('');
  }
  function signOut() { void shared.signOut(); onExit(); }
  async function createRoom() {
    if (!session || busy || expired) return;
    if (!name.trim()) { setError('Enter a room name.'); return; }
    setBusy(true); setError('');
    try {
      const created = await request<Room>('/rooms', session, { name: name.trim(), visibility, invitees: roomInvitees.map(player => player.user_id) });
      if (!mounted.current) return;
      setName(''); setRoomInviteQuery(''); setRoomInviteResults([]); setRoomInvitees([]); enterRoom(created);
    } catch (error) { if (mounted.current) setError(error instanceof Error ? error.message : 'Could not create room.'); }
    finally { if (mounted.current) setBusy(false); }
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

  const roomMembers = [...new Set([...(current?.members || []), ...(room && session && shared.status === 'connected' ? [session.user_id] : [])])];
  const selectedGame = game === 'flush' || game === 'marriage' ? game : 'callbreak';
  return <HeaderProfileContext.Provider value={session && !expired ? close => <ProfileScreen session={session} personal={personal} onBack={close} onSignOut={signOut} /> : null}><View style={{ flex: 1 }}><ScrollView style={styles.page} contentContainerStyle={[styles.container, {
    paddingTop: Math.max(insets.top, 24), paddingBottom: Math.max(insets.bottom, 28) + (room ? 64 : 0),
  }]}>
    <View style={styles.content}>
      <AppHeader inlineActions={session && !expired ? <NotificationBell session={session} onOpenTable={invited => {
        setLinkedMatch(invited.match_id);
        enterRoom({ room_id: invited.room_id, name: invited.table_name, members: [] }, invited.game_type);
      }} onOpenRoom={invited => enterRoom({ room_id: invited.room_id, name: invited.room_name, members: [] })} /> : null} />
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
            <Text accessibilityRole="header" style={[styles.roomTitle, !wide && styles.mobileRoomTitle]}>{current?.name || room.name}</Text>
            <Text style={styles.subtitle}>{current?.connected_members?.length || 0} online · {roomMembers.length} members</Text>
          </View>
          <View style={styles.roomActions}>
            <HeaderAction icon="leave" label="Back to lobby" onPress={() => { setLinkedMatch(undefined); shared.exitRoom(); }} />
          </View>
        </View>
        <View style={[styles.columns, wide && styles.wideColumns]}>
          <View style={styles.mainColumn}>
            {session && <RoomGameControl onOpenChange={setGameOpen} requestedMatchId={linkedMatch} personal={personal} key={room.room_id} roomId={room.room_id} apiUrl={apiUrl} token={session.token} userId={session.user_id} pokes={shared.pokes} connected={shared.status === 'connected' && !expired} members={current?.connected_members || []} roomMembers={roomMembers} connectionMessage={expired ? shared.error : undefined}
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
          <View style={[styles.sideColumn, wide && styles.fixedSide]}>
            {session && <RoomLedger roomId={room.room_id} session={session} />}
            <View style={styles.panel}>
              <Pressable accessibilityRole="button" accessibilityLabel="Invite people" aria-expanded={inviteOpen} accessibilityState={{ expanded: inviteOpen }} onPress={() => setInviteOpen(value => !value)} style={styles.sectionToggle}>
                <Text style={styles.sectionTitle}>Invite people</Text><Text style={styles.sectionTitle}>{inviteOpen ? '-' : '+'}</Text>
              </Pressable>
              {inviteOpen && <View>
                <Text style={styles.description}>Share the room link or code. After entering, each person can choose a table to play or watch.</Text>
                <View style={styles.codeBox}><Text style={styles.codeLabel}>ROOM CODE</Text><Text selectable accessibilityLabel={`Room code ${room.room_id}`} style={styles.code}>{room.room_id}</Text></View>
                <View style={styles.gameTabs}><ShareLink roomId={room.room_id} /><CopyRoomCode roomId={room.room_id} /></View>
              </View>}
            </View>
            {room.creator_id === session?.user_id && <View style={styles.panel}>
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
            {room.creator_id !== session?.user_id && <View style={styles.panel}>
              <Text style={styles.sectionTitle}>Room membership</Text>
              <Text style={styles.description}>Leave this room to remove it from your rooms. You can join it again later if you still have access.</Text>
              <Pressable accessibilityRole="button" accessibilityLabel="Leave room membership" onPress={() => void leaveMembership()} style={styles.dangerButton}><Text style={styles.dangerText}>Leave room</Text></Pressable>
            </View>}
            <View style={styles.panel}>
              <Pressable accessibilityRole="button" accessibilityLabel="Room members" aria-expanded={membersOpen} accessibilityState={{ expanded: membersOpen }} onPress={() => setMembersOpen(value => !value)} style={styles.sectionToggle}>
                <Text style={styles.sectionTitle}>Room members · {roomMembers.length}</Text><Text style={styles.sectionTitle}>{membersOpen ? '-' : '+'}</Text>
              </Pressable>
              {membersOpen && roomMembers.map((member, index) => <View key={member} style={styles.member}>
                <View style={styles.avatar}><Text style={styles.avatarText}>{member === session?.user_id ? 'Y' : String(index + 1)}</Text></View>
                <Text style={styles.directoryName}>{member === session?.user_id ? 'You' : `Guest ${index + 1}`}</Text>
                <Text style={styles.online}>{current?.connected_members?.includes(member) ? 'Online' : 'Offline'}</Text>
              </View>)}
            </View>
          </View>
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
          {roomToolsOpen && <Modal transparent animationType="slide" onRequestClose={() => setRoomToolsOpen(false)}><View style={styles.sheetBackdrop}><View accessibilityViewIsModal style={styles.sheet}><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 24, gap: 8 }}>
            <Pressable accessibilityRole="button" accessibilityLabel="Close room form" onPress={() => setRoomToolsOpen(false)} style={styles.textButton}><Text style={styles.enterText}>Close</Text></Pressable>
            <View style={styles.gameTabs}>
              <Pressable accessibilityRole="button" accessibilityState={{ selected: form === 'create' }} onPress={() => setForm('create')} style={[styles.gameTab, form === 'create' && styles.selectedTab]}><Text style={[styles.tabText, form === 'create' && styles.selectedTabText]}>Create room</Text></Pressable>
              <Pressable accessibilityRole="button" accessibilityState={{ selected: form === 'join' }} onPress={() => setForm('join')} style={[styles.gameTab, form === 'join' && styles.selectedTab]}><Text style={[styles.tabText, form === 'join' && styles.selectedTabText]}>Join with code</Text></Pressable>
            </View>
            {form === 'create' ? <>
              <TextInput accessibilityLabel="Room name" value={name} onChangeText={setName} maxLength={60} placeholder="e.g. Friday friends" placeholderTextColor={colors.textMuted} style={styles.input} editable={!busy} />
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
              <TextInput accessibilityLabel="Find people to invite to room" value={roomInviteQuery} onChangeText={setRoomInviteQuery} maxLength={64} placeholder="Name, username, or user ID" placeholderTextColor={colors.textMuted} autoCapitalize="none" autoCorrect={false} returnKeyType="search" onSubmitEditing={() => void searchRoomDirectory()} style={styles.input} />
              <Pressable accessibilityRole="button" disabled={roomInviteSearching || roomInviteQuery.trim().length < 2} onPress={() => void searchRoomDirectory()} style={[styles.button, (roomInviteSearching || roomInviteQuery.trim().length < 2) && styles.disabled]}><Text style={styles.buttonText}>{roomInviteSearching ? 'Searching…' : 'Search directory'}</Text></Pressable>
              {!!roomInvitees.length && <View>{roomInvitees.map(player => <Pressable key={player.user_id} accessibilityRole="button" accessibilityLabel={`Remove ${player.display_name || player.username || player.user_id}`} onPress={() => setRoomInvitees(current => current.filter(item => item.user_id !== player.user_id))} style={styles.gameTab}><Text style={styles.tabText}>{player.display_name || player.username || player.user_id} · Remove</Text></Pressable>)}</View>}
              {!!roomInviteResults.length && <View>{roomInviteResults.filter(player => !roomInvitees.some(selected => selected.user_id === player.user_id)).map(player => <Pressable key={player.user_id} accessibilityRole="button" accessibilityLabel={`Invite ${player.display_name || player.username || player.user_id} to room`} onPress={() => setRoomInvitees(current => [...current, player])} style={styles.gameTab}><Text style={styles.directoryName}>{player.display_name || player.username || 'Player'}</Text><Text style={styles.description}>{player.username ? `@${player.username} · ` : ''}{player.user_id}</Text></Pressable>)}</View>}
              {!!roomInviteError && <Text accessibilityRole="alert" style={styles.error}>{roomInviteError}</Text>}
              </>}
              <Pressable accessibilityRole="button" disabled={!session || busy || expired} accessibilityState={{ disabled: !session || busy || expired }} onPress={createRoom} style={[styles.button, (!session || busy || expired) && styles.disabled]}><Text style={styles.buttonText}>Create room</Text></Pressable>
            </> : <>
              <TextInput accessibilityLabel="Room code" value={code} onChangeText={setCode} autoCapitalize="none" autoCorrect={false} maxLength={64} placeholder="Paste a room code" placeholderTextColor={colors.textMuted} style={styles.input} editable={!busy} />
              <Pressable accessibilityRole="button" disabled={!session || busy || expired} accessibilityState={{ disabled: !session || busy || expired }} onPress={() => {
                const target = rooms.find(item => item.room_id === code.trim());
                if (code.trim()) joinRoom(target || { room_id: code.trim(), name: 'Joined room', members: [] });
                else setError('Enter a room code.');
              }} style={[styles.button, (!session || busy || expired) && styles.disabled]}><Text style={styles.buttonText}>Join room</Text></Pressable>
            </>}
            {!!(error || shared.error) && <Text accessibilityRole="alert" style={styles.error}>{error || shared.error}</Text>}
            {busy && <Text accessibilityLiveRegion="polite" style={styles.description}>Entering room…</Text>}
          </ScrollView></View></View></Modal>}
          {session && !expired && <>
            {shared.memberships.filter(m => m.active_game?.player_is_participant && m.active_game.status !== 'ended').map(m => {
              const target = rooms.find(r => r.room_id === m.room_id), active = m.active_game!;
              if (!target) return null;
              return <Pressable key={m.room_id} accessibilityRole="button" accessibilityLabel={`Return to table · ${target.name}`} onPress={() => { setLinkedMatch(active.game_id); enterRoom(target, active.game_type); }} style={styles.panel}>
                <Text style={styles.eyebrow}>CONTINUE PLAYING</Text><Text style={styles.heading}>{target.name}</Text><Text style={styles.enterText}>Return to table →</Text>
              </Pressable>;
            })}
            <Text accessibilityRole="header" style={styles.sectionTitle}>Your rooms</Text>
            {!enterRooms.length && <Text style={styles.description}>Create a room or join your friends to get started.</Text>}
            {enterRooms.map(item => <RoomCard key={item.room_id} room={item} member busy={busy}
              activeTables={shared.memberships.find(m => m.room_id === item.room_id)?.tables.filter(t => t.status !== 'ended' && t.status !== 'finished').length}
              onPress={() => { setLinkedMatch(undefined); enterRoom(item); }} />)}
            {!!friendRooms.length && <Text accessibilityRole="header" style={styles.sectionTitle}>Friends’ rooms</Text>}
            {friendRooms.map(item => <RoomCard key={item.room_id} room={item} member={false} busy={busy} onPress={() => joinRoom(item)} />)}
          </>}
        </View>}
        {session && !expired && lobbyTab === 'players' && <View style={styles.playersArea}><FriendsPanel session={session} /></View>}
      </>}
    </View>
  </ScrollView>{room && !expired && !invitation && !gameOpen && chat}</View></HeaderProfileContext.Provider>;
}
const createStyles = (colors: ThemeColors) => StyleSheet.create({
  sheetBackdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'center', alignItems: 'center', padding: 16 },
  sheet: { width: '100%', maxWidth: 540, maxHeight: '90%', borderRadius: 20, backgroundColor: colors.surface },
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
  roomRowActions: { alignItems: 'stretch', gap: 4, minWidth: 86 }, rowDangerButton: { minHeight: 40, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 8 },
  comingSoon: { paddingVertical: 24, gap: 10 }, footer: { fontFamily: fonts.body, fontSize: 10, color: colors.textMuted, marginVertical: 24, textAlign: 'center' }, error: { color: colors.danger, fontFamily: fonts.body, fontSize: 12, lineHeight: 20, marginVertical: 12 },
});
