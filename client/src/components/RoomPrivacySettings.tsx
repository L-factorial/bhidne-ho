import { ui, uiLabel } from '../i18n/copy.ts';
import { useUiLanguage } from '../i18n/useUiLanguage';
import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { request } from '../multiplayer/api';
import type { Room, Session } from '../multiplayer/session';
import { fonts, useTheme } from '../theme';

export function RoomPrivacySettings({ room, session }: { room: Room; session: Session }) {
  useUiLanguage();
  const { colors: c } = useTheme();
  const [visibility, setVisibility] = useState(room.visibility === 'public' ? "public" : "private");
  const [query, setQuery] = useState(''), [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const [players, setPlayers] = useState<{user_id: string; display_name?: string; username?: string}[]>([]);
  async function change(value: 'private' | 'public') {
    setBusy(true); setMessage('');
    try { await request('/rooms/' + room.room_id, session, {visibility: value}, undefined, 'PATCH'); setVisibility(value); }
    catch (e) { setMessage((e as Error).message); } finally { setBusy(false); }
  }
  async function search() {
    setBusy(true); setMessage('');
    try { const result = await request<typeof players>('/players/directory?q=' + encodeURIComponent(query.trim()), session); setPlayers(result.filter(p => p.user_id !== session.user_id && !room.members.includes(p.user_id))); if (!result.length) setMessage(ui("feedback.no_players_found_use_an_exact_username_or_user_id")); }
    catch (e) { setMessage((e as Error).message); } finally { setBusy(false); }
  }
  async function invite(id: string) {
    setBusy(true); setMessage('');
    try { await request('/rooms/' + room.room_id + '/invitations', session, {invitees: [id]}); setPlayers(list => list.filter(p => p.user_id !== id)); setMessage(ui("rooms.invitation_sent_they_become_a_member_when_they_join")); }
    catch (e) { setMessage((e as Error).message); } finally { setBusy(false); }
  }
  return <View style={{gap: 12}}>
    <Text style={{color:c.text, fontFamily:fonts.medium}}>{ui("rooms.room_privacy")}</Text>
    <View style={{flexDirection:'row',gap:8}}>
      {(["private","public"] as const).map(value => <Pressable key={value} accessibilityRole="button" accessibilityLabel={ui("rooms.make_room_visibility", { visibility: uiLabel(value, "rooms") })} accessibilityState={{selected: visibility === value, disabled:busy}} disabled={busy} onPress={() => void change(value)} style={{minHeight:44,padding:12,borderRadius:10,borderWidth:1,borderColor:visibility===value?c.accent:c.border,backgroundColor:visibility===value?c.surfaceSelected:c.surface}}>
        <Text style={{color:c.text}}>{value === 'private' ? ui("rooms.private") : ui("rooms.public")}</Text>
      </Pressable>)}
    </View>
    <Text style={{color:c.textMuted}}>{visibility === 'private' ? 'Only invited people and existing members can enter. Links do not grant access.' : ui("rooms.everyone_can_discover_and_join_this_room")}</Text>
    <Text style={{color:c.text,fontFamily:fonts.medium}}>{ui("rooms.invite_people")}</Text>
    <TextInput accessibilityLabel={ui("rooms.find_player_to_invite")} placeholder={ui("rooms.username_or_user_id")} placeholderTextColor={c.textMuted} value={query} onChangeText={setQuery} autoCapitalize="none" style={{color:c.text,borderWidth:1,borderColor:c.border,padding:12,borderRadius:10}} />
    <Pressable accessibilityRole="button" disabled={busy || !query.trim()} onPress={() => void search()} style={{minHeight:44,justifyContent:'center'}}><Text style={{color:c.accent}}>{ui("rooms.search_players")}</Text></Pressable>
    {players.map(p => <Pressable key={p.user_id} accessibilityRole="button" disabled={busy} onPress={() => void invite(p.user_id)} style={{minHeight:44,justifyContent:'center'}}><Text style={{color:c.text}}>{ui("rooms.invite_player", { "player": p.display_name || p.username || p.user_id })}</Text></Pressable>)}
    {!!message && <Text accessibilityLiveRegion="polite" style={{color:c.text}}>{message}</Text>}
  </View>;
}
