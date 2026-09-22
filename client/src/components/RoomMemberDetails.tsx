import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { RoomSheet } from './RoomSheet';
import { PlayerAvatar } from './PlayerAvatar';
import { fonts, useTheme } from '../theme';
import { request } from '../multiplayer/api';
import type { Session } from '../multiplayer/session';

type Member = { user_id: string; display_name: string; username?: string | null; avatar_url?: string };
export function RoomMemberDetails({ member, session, online, onClose }: { member: Member | null; session: Session; online: boolean; onClose: () => void }) {
  const { colors: c } = useTheme();
  const [relationship, setRelationship] = useState<'loading' | 'self' | 'friend' | 'incoming' | 'outgoing' | 'none'>('loading');
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  useEffect(() => {
    setError(''); setRelationship('loading');
    if (!member) return;
    if (member.user_id === session.user_id) { setRelationship('self'); return; }
    const controller = new AbortController();
    void request<{ friends: Member[]; incoming: Member[]; outgoing: Member[] }>('/friends', session, undefined, controller.signal).then(result => {
      if (!controller.signal.aborted) setRelationship(result.friends.some(p => p.user_id === member.user_id) ? 'friend' : result.incoming.some(p => p.user_id === member.user_id) ? 'incoming' : result.outgoing.some(p => p.user_id === member.user_id) ? 'outgoing' : 'none');
    }).catch(e => { if (!controller.signal.aborted) setError(e.message); });
    return () => controller.abort();
  }, [member?.user_id, session.token]);
  async function add() {
    if (!member || busy) return;
    setBusy(true); setError('');
    try { await request(`/friends/requests/${encodeURIComponent(member.user_id)}${relationship === 'incoming' ? '/accept' : ''}`, session, {}); setRelationship(relationship === 'incoming' ? 'friend' : 'outgoing'); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <RoomSheet visible={!!member} title="Player profile" closeLabel="Close player profile" onClose={onClose}>
    {member && <><View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}><PlayerAvatar uri={member.avatar_url} /><View style={{ flex: 1, gap: 4 }}><Text style={{ color: c.text, fontFamily: fonts.medium, fontSize: 20 }}>{member.display_name}</Text>{!!member.username && <Text style={{ color: c.textMuted }}>@{member.username}</Text>}<Text style={{ color: online ? c.success : c.textMuted }}>{online ? 'Online' : 'Offline'}</Text></View></View>
      {['none', 'incoming'].includes(relationship) && <Pressable accessibilityRole="button" disabled={busy} onPress={() => void add()} style={{ minHeight: 48, backgroundColor: c.primary, borderRadius: 12, justifyContent: 'center', alignItems: 'center', opacity: busy ? 0.5 : 1 }}><Text style={{ color: c.onPrimary, fontFamily: fonts.medium }}>{relationship === 'incoming' ? 'Accept friend request' : 'Add friend'}</Text></Pressable>}
      {relationship === 'friend' && <Text style={{ color: c.success }}>You’re friends. Your conversation is available in Friends.</Text>}
      {relationship === 'outgoing' && <Text style={{ color: c.textMuted }}>Friend request sent</Text>}
      {!!error && <Text accessibilityRole="alert" style={{ color: c.danger }}>{error}</Text>}
    </>}
  </RoomSheet>;
}
