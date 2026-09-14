import { useState } from 'react';
import { Platform, Pressable, Share, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { invitationLink } from '../multiplayer/invitations';
import { useTheme } from '../theme';

export function ShareLink({ roomId, matchId }: { roomId: string; matchId?: string }) {
  const { colors } = useTheme();
  const [notice, setNotice] = useState('');
  const kind = matchId ? 'game' : 'room';
  const base = Platform.OS === 'web' ? globalThis.location.href : process.env.EXPO_PUBLIC_WEB_URL || 'https://bhidne-ho.lfactorial.com/';
  const url = invitationLink(base, { roomId, matchId });
  async function copy() {
    try {
      if (!await Clipboard.setStringAsync(url)) throw new Error('Copy unavailable');
      setNotice(`${matchId ? 'Game' : 'Room'} link copied.`);
    } catch { setNotice('Could not copy automatically. Select and copy the link below.'); }
  }
  async function share() {
    try {
      if (Platform.OS === 'web') {
        if (typeof navigator.share === 'function') await navigator.share({ title: 'Bhidne Ho', text: `Join my ${kind} on Bhidne Ho`, url });
        else { await copy(); return; }
      } else await Share.share({ message: `Join my ${kind} on Bhidne Ho: ${url}` });
      setNotice('');
    } catch (error) { if (!(error instanceof Error && error.name === 'AbortError')) setNotice('Sharing unavailable. Copy the link instead.'); }
  }
  return <View style={{ gap: 4, padding: 8 }}>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
      <Pressable accessibilityRole="button" accessibilityLabel={`Copy ${kind} link`} onPress={() => void copy()} style={{ padding: 10 }}><Text style={{ color: colors.accent }}>Copy {kind} link</Text></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={`Share ${kind} link`} onPress={() => void share()} style={{ padding: 10 }}><Text style={{ color: colors.accent }}>Share {kind} link</Text></Pressable>
    </View>
    <Text selectable accessibilityLabel={`${kind} invitation link`} style={{ color: colors.textMuted, fontSize: 11 }}>{url}</Text>
    {!!notice && <Text accessibilityLiveRegion="polite" style={{ color: colors.text }}>{notice}</Text>}
  </View>;
}
