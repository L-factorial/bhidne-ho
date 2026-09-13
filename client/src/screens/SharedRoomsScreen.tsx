import { AppHeader, HeaderProfileContext } from '../components/AppHeader';
import { HeaderAction } from '../components/HeaderAction';
import { GameIcon } from '../components/BrandArt';
import { Image } from 'react-native';
import { branding } from '../branding';
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CallBreakTableScreen } from './CallBreakTableScreen';
import { fonts, useTheme, useThemedStyles, type ThemeColors } from '../theme';
import { ProfileScreen } from './ProfileScreen';
import { usePlayerPhrases } from '../multiplayer/usePlayerPhrases';
import { RoomChat } from '../components/RoomChat';
import { RoomGameControl } from '../components/RoomGameControl';

import { apiUrl, request } from '../multiplayer/api';
import type { Room } from '../multiplayer/session';
import { useRoomSession } from '../multiplayer/useRoomSession';

export function SharedRoomsScreen({ onExit }: { onExit: () => void }) {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const insets = useSafeAreaInsets();
  const wide = useWindowDimensions().width >= 900;
  const [roomToolsOpen, setRoomToolsOpen] = useState(false);
  const [roomsOpen, setRoomsOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);
  const [form, setForm] = useState<'create' | 'join'>('create');
  const [testingOpen, setTestingOpen] = useState(false);
  const [preview, setPreview] = useState(false);
  const [previewSize, setPreviewSize] = useState<4 | 5>(4);
  const shared = useRoomSession();
  const { session, rooms, room, game, setGame, expired } = shared;
  useEffect(() => {
    setInviteOpen(false); setMembersOpen(false);
  }, [room?.room_id]);
  const personal = usePlayerPhrases(session, !!session && !expired);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  async function leaveRoom() {
    if (!await shared.leaveRoom()) return; setRoomToolsOpen(false); setRoomsOpen(false); setPreview(false); setTestingOpen(false); setError('');
  }
  function joinRoom(target: Room) {
    shared.joinRoom(target); setPreview(false); setTestingOpen(false); setError('');
  }
  function signOut() { shared.signOut(); onExit(); }
  async function createRoom() {
    if (!session || busy || expired) return;
    if (!name.trim()) { setError('Enter a room name.'); return; }
    setBusy(true); setError('');
    try {
      const created = await request<Room>('/rooms', session, { name: name.trim() });
      if (!mounted.current) return;
      setName(''); joinRoom(created);
    } catch (error) { if (mounted.current) setError(error instanceof Error ? error.message : 'Could not create room.'); }
    finally { if (mounted.current) setBusy(false); }
  }
  const current = rooms.find(item => item.room_id === room?.room_id) || room;
  const roomMembers = [...new Set([...(current?.members || []), ...(room && session && shared.status === 'connected' ? [session.user_id] : [])])];
  if (room && preview) return <CallBreakTableScreen capacity={previewSize} names={['You']} tableName={room.name} onBack={() => setPreview(false)} />;
  const selectedGame = game === 'flush' || game === 'marriage' ? game : 'callbreak';
  return <HeaderProfileContext.Provider value={session && !expired ? close => <ProfileScreen session={session} personal={personal} onBack={close} /> : null}><ScrollView style={styles.page} contentContainerStyle={[styles.container, {
    paddingTop: Math.max(insets.top, 24), paddingBottom: Math.max(insets.bottom, 28),
  }]}>
    <View style={styles.content}>
      <AppHeader />
      <View style={styles.roomNavigation}>
        <Text style={styles.navigationLabel}>{room && !expired ? 'ROOM LOBBY' : 'YOUR SPACE'}</Text>
        <HeaderAction icon="leave" label={room && !expired ? 'Leave room' : 'Sign out'} onPress={room && !expired ? leaveRoom : signOut} />
      </View>
      {!!(error || shared.error) && <Text accessibilityRole="alert" style={styles.error}>{error || shared.error}</Text>}
      {room && !expired && shared.status !== 'connected' && <Text accessibilityLiveRegion="polite" style={styles.subtitle}>Reconnecting to your room…</Text>}
      {room ? <>
        <View style={styles.hero}>
          <Text style={styles.eyebrow}>YOUR ROOM</Text>
          <Text accessibilityRole="header" style={[styles.title, !wide && styles.mobileTitle]}>{room.name}</Text>
          <Text style={styles.subtitle}>{roomMembers.length} {roomMembers.length === 1 ? 'player' : 'players'} in the room · Invite friends to take a seat.</Text>
        </View>
        <View style={[styles.columns, wide && styles.wideColumns]}>
          <View style={styles.mainColumn}>
            {session && <RoomGameControl personal={personal} key={room.room_id} roomId={room.room_id} apiUrl={apiUrl} token={session.token} userId={session.user_id} pokes={shared.pokes} connected={shared.status === 'connected' && !expired} members={roomMembers} connectionMessage={expired ? shared.error : undefined}
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
            {session && <RoomChat key={room.room_id} roomId={room.room_id} session={session} connected={shared.status === 'connected' && !expired} />}
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
            <View style={styles.panel}>
              <Pressable accessibilityRole="button" accessibilityLabel="Currently in the room" aria-expanded={membersOpen} accessibilityState={{ expanded: membersOpen }} onPress={() => setMembersOpen(value => !value)} style={styles.sectionToggle}>
                <Text style={styles.sectionTitle}>Currently in the room · {roomMembers.length}</Text><Text style={styles.sectionTitle}>{membersOpen ? '-' : '+'}</Text>
              </Pressable>
              {membersOpen && roomMembers.map((member, index) => <View key={member} style={styles.member}>
                <View style={styles.avatar}><Text style={styles.avatarText}>{member === session?.user_id ? 'Y' : String(index + 1)}</Text></View>
                <Text style={styles.directoryName}>{member === session?.user_id ? 'You' : `Guest ${index + 1}`}</Text>
                <Text style={styles.online}>Online</Text>
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
        <Image source={branding.background} accessibilityLabel="Play. Connect. Bhidne Ho!" resizeMode="contain" style={{ width: '100%', maxWidth: 415, aspectRatio: 415 / 182, alignSelf: 'center', marginTop: 20, borderRadius: 16 }} />
        {!session && <View><Text style={styles.subtitle}>{shared.error ? 'Guest connection unavailable.' : 'Connecting as a guest…'}</Text>
          {!!shared.error && <Pressable accessibilityRole="button" onPress={shared.retry} style={styles.button}><Text style={styles.buttonText}>Retry connection</Text></Pressable>}</View>}
        <View style={[styles.columns, { marginTop: 24 }]}>
          <View style={styles.panel}>
            <Pressable accessibilityRole="button" accessibilityLabel="Create room / Join with code" aria-expanded={roomToolsOpen} accessibilityState={{ expanded: roomToolsOpen }} onPress={() => setRoomToolsOpen(value => !value)} style={styles.sectionToggle}>
              <Text style={styles.sectionTitle}>Create room / Join with code</Text><Text style={styles.sectionTitle}>{roomToolsOpen ? '-' : '+'}</Text>
            </Pressable>
            {roomToolsOpen && <View>
            <View style={styles.gameTabs}>
              <Pressable accessibilityRole="button" accessibilityState={{ selected: form === 'create' }} onPress={() => setForm('create')} style={[styles.gameTab, form === 'create' && styles.selectedTab]}><Text style={[styles.tabText, form === 'create' && styles.selectedTabText]}>Create room</Text></Pressable>
              <Pressable accessibilityRole="button" accessibilityState={{ selected: form === 'join' }} onPress={() => setForm('join')} style={[styles.gameTab, form === 'join' && styles.selectedTab]}><Text style={[styles.tabText, form === 'join' && styles.selectedTabText]}>Join with code</Text></Pressable>
            </View>
            {form === 'create' ? <>
              <TextInput accessibilityLabel="Room name" value={name} onChangeText={setName} maxLength={60} placeholder="e.g. Friday friends" placeholderTextColor={colors.textMuted} style={styles.input} editable={!busy} />
              <Pressable accessibilityRole="button" disabled={!session || busy || expired} accessibilityState={{ disabled: !session || busy || expired }} onPress={createRoom} style={[styles.button, (!session || busy || expired) && styles.disabled]}><Text style={styles.buttonText}>Create and enter room</Text></Pressable>
            </> : <>
              <TextInput accessibilityLabel="Table code / room ID" value={code} onChangeText={setCode} autoCapitalize="none" autoCorrect={false} maxLength={64} placeholder="Paste a table code" placeholderTextColor={colors.textMuted} style={styles.input} editable={!busy} />
              <Pressable accessibilityRole="button" disabled={!session || busy || expired} accessibilityState={{ disabled: !session || busy || expired }} onPress={() => {
                const target = rooms.find(item => item.room_id === code.trim());
                if (target) joinRoom(target); else setError('Table code not found. Choose a listed room or check the code.');
              }} style={[styles.button, (!session || busy || expired) && styles.disabled]}><Text style={styles.buttonText}>Enter with table code</Text></Pressable>
            </>}
            {busy && <Text accessibilityLiveRegion="polite" style={styles.description}>Entering room…</Text>}
            </View>}
          </View>
          <View style={styles.panel}>
            <Pressable accessibilityRole="button" accessibilityLabel="Available rooms" aria-expanded={roomsOpen} accessibilityState={{ expanded: roomsOpen }} onPress={() => setRoomsOpen(value => !value)} style={styles.sectionToggle}>
              <Text style={styles.sectionTitle}>Available rooms</Text><Text style={styles.sectionTitle}>{roomsOpen ? '-' : '+'}</Text>
            </Pressable>
            {roomsOpen && <View>
            {session && !rooms.length && <View style={styles.comingSoon}><Text style={styles.heading}>The first table is yours.</Text><Text style={styles.description}>Create a room to get things started.</Text></View>}
            {rooms.map(item => <View key={item.room_id} style={styles.roomRow}>
              <View style={{ flex: 1 }}><Text style={styles.directoryName}>{item.name}</Text><Text selectable style={styles.description}>Table code: {item.room_id}</Text><Text style={styles.description}>{item.members.length} connected</Text></View>
              <Pressable accessibilityRole="button" accessibilityLabel={`Enter ${item.name}`} disabled={busy} accessibilityState={{ disabled: busy }} onPress={() => joinRoom(item)} style={[styles.enterButton, busy && styles.disabled]}><Text style={styles.enterText}>Enter →</Text></Pressable>
            </View>)}
            </View>}
          </View>
        </View>
      </>}
    </View>
  </ScrollView></HeaderProfileContext.Provider>;
}
const createStyles = (colors: ThemeColors) => StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background }, container: { alignItems: 'center', paddingHorizontal: 20 }, content: { width: '100%', maxWidth: 1120 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  roomNavigation: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingTop: 14 },
  navigationLabel: { fontFamily: fonts.medium, fontSize: 10, letterSpacing: 2, color: colors.textMuted },
  header: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 16, borderBottomWidth: 1, borderColor: colors.border, paddingBottom: 18 },
  brand: { fontFamily: fonts.body, fontSize: 26, color: colors.accent }, textButton: { minHeight: 44, justifyContent: 'center' }, lightText: { fontFamily: fonts.medium, fontSize: 12, color: colors.accent },
  hero: { paddingVertical: 32, gap: 10 }, eyebrow: { fontFamily: fonts.medium, fontSize: 9, letterSpacing: 2, color: colors.accent }, title: { fontFamily: fonts.display, fontSize: 52, color: colors.text }, mobileTitle: { fontSize: 38 }, subtitle: { fontFamily: fonts.body, fontSize: 13, lineHeight: 23, color: colors.textMuted },
  sectionToggle: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }, sectionTitle: { fontFamily: fonts.medium, fontSize: 14, color: colors.text },
  columns: { gap: 20 }, wideColumns: { flexDirection: 'row', alignItems: 'flex-start' }, sideColumn: { gap: 18 }, fixedSide: { width: 330 }, mainColumn: { flex: 1, minWidth: 0 },
  panel: { backgroundColor: colors.surface, borderRadius: 16, padding: 24, gap: 8 }, heading: { fontFamily: fonts.display, fontSize: 27, color: colors.text }, description: { fontFamily: fonts.body, fontSize: 12, lineHeight: 21, color: colors.textMuted },
  gameTabs: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 14 }, gameTab: { minHeight: 44, paddingHorizontal: 12, paddingVertical: 8, gap: 6, alignItems: 'center', justifyContent: 'center', borderRadius: 8, backgroundColor: colors.surface }, selectedTab: { backgroundColor: colors.surfaceSelected }, tabText: { fontFamily: fonts.medium, fontSize: 12, color: colors.textMuted }, selectedTabText: { color: colors.text }, eyebrowDark: { fontFamily: fonts.medium, fontSize: 9, letterSpacing: 2, color: colors.accent }, gameTitle: { fontFamily: fonts.display, fontSize: 34, color: colors.text },
  codeBox: { backgroundColor: colors.surface, borderRadius: 10, padding: 16, marginVertical: 10, gap: 8 }, codeLabel: { fontFamily: fonts.medium, color: colors.accent, fontSize: 9, letterSpacing: 2 }, code: { fontFamily: fonts.medium, fontSize: 22, letterSpacing: 1, color: colors.text },
  member: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 }, avatar: { width: 30, height: 30, borderRadius: 15, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' }, avatarText: { fontFamily: fonts.medium, fontSize: 11, color: colors.accent }, online: { fontFamily: fonts.body, fontSize: 10, color: colors.textMuted, marginLeft: 'auto' },
  input: { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, borderRadius: 8, minHeight: 48, padding: 14, fontFamily: fonts.body, color: colors.text, marginVertical: 10 },
  button: { backgroundColor: colors.surfaceSelected, minHeight: 48, borderRadius: 8, alignItems: 'center', justifyContent: 'center', padding: 12 }, buttonText: { fontFamily: fonts.medium, color: colors.text, fontSize: 12 }, disabled: { opacity: 0.5 },
  roomRow: { flexDirection: 'row', gap: 12, alignItems: 'center', borderBottomWidth: 1, borderColor: colors.border, paddingVertical: 18 }, directoryName: { fontFamily: fonts.medium, fontSize: 14, color: colors.text, flexShrink: 1 }, enterButton: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 8 }, enterText: { fontFamily: fonts.medium, fontSize: 12, color: colors.accent },
  testing: { marginTop: 24, borderTopWidth: 1, borderColor: colors.border }, testingToggle: { minHeight: 54, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, testingBody: { gap: 16, paddingBottom: 20 },
  comingSoon: { paddingVertical: 24, gap: 10 }, footer: { fontFamily: fonts.body, fontSize: 10, color: colors.textMuted, marginVertical: 24, textAlign: 'center' }, error: { color: colors.danger, fontFamily: fonts.body, fontSize: 12, lineHeight: 20, marginVertical: 12 },
});
