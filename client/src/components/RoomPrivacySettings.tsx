import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { request } from '../multiplayer/api';
import type { Room, Session } from '../multiplayer/session';
import { fonts, useTheme } from '../theme';

export function RoomPrivacySettings({ room, session }: { room: Room; session: Session }) {
  const { colors: c } = useTheme();
  const [visibility, setVisibility] = useState(room.visibility === 'public' ? 'public' : 'private');
  const [query, setQuery] = useState(''), [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const [players, setPlayers] = useState<{user_id: string; display_name?: string; username?: string}[]>([]);
  async function change(value: 'private' | 'public') {
    setBusy(true); setMessage('');
    try { await request('/rooms/' + room.room_id, session, {visibility: value}, undefined, 'PATCH'); setVisibility(value); }
    catch (e) { setMessage((e as Error).message); } finally { setBusy(false); }
  }
  async function search() {
    setBusy(true); setMessage('');
    try { const result = await request<typeof players>('/players/directory?q=' + encodeURIComponent(query.trim()), session); setPlayers(result.filter(p => p.user_id !== session.user_id && !room.members.includes(p.user_id))); if (!result.length) setMessage('No players found. Use an exact username or user ID.'); }
    catch (e) { setMessage((e as Error).message); } finally { setBusy(false); }
  }
  async function invite(id: string) {
    setBusy(true); setMessage('');
    try { await request('/rooms/' + room.room_id + '/invitations', session, {invitees: [id]}); setPlayers(list => list.filter(p => p.user_id !== id)); setMessage('Invitation sent. They become a member when they join.'); }
    catch (e) { setMessage((e as Error).message); } finally { setBusy(false); }
  }
  return <View style={{gap: 12}}>
    <Text style={{color:c.text, fontFamily:fonts.medium}}>Room privacy</Text>
    <View style={{flexDirection:'row',gap:8}}>
      {(['private','public'] as const).map(value => <Pressable key={value} accessibilityRole="button" accessibilityLabel={'Make room ' + value} accessibilityState={{selected: visibility === value, disabled:busy}} disabled={busy} onPress={() => void change(value)} style={{minHeight:44,padding:12,borderRadius:10,borderWidth:1,borderColor:visibility===value?c.accent:c.border,backgroundColor:visibility===value?c.surfaceSelected:c.surface}}>
        <Text style={{color:c.text}}>{value === 'private' ? 'Private' : 'Public'}</Text>
      </Pressable>)}
    </View>
    <Text style={{color:c.textMuted}}>{visibility === 'private' ? 'Only invited people and existing members can enter. Links do not grant access.' : 'Everyone can discover and join this room.'}</Text>
    <Text style={{color:c.text,fontFamily:fonts.medium}}>Invite people</Text>
    <TextInput accessibilityLabel="Find player to invite" placeholder="Username or user ID" placeholderTextColor={c.textMuted} value={query} onChangeText={setQuery} autoCapitalize="none" style={{color:c.text,borderWidth:1,borderColor:c.border,padding:12,borderRadius:10}} />
    <Pressable accessibilityRole="button" disabled={busy || !query.trim()} onPress={() => void search()} style={{minHeight:44,justifyContent:'center'}}><Text style={{color:c.accent}}>Search players</Text></Pressable>
    {players.map(p => <Pressable key={p.user_id} accessibilityRole="button" disabled={busy} onPress={() => void invite(p.user_id)} style={{minHeight:44,justifyContent:'center'}}><Text style={{color:c.text}}>Invite {p.display_name || p.username || p.user_id}</Text></Pressable>)}
    {!!message && <Text accessibilityLiveRegion="polite" style={{color:c.text}}>{message}</Text>}
  </View>;
}
