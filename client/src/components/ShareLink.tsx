import { Ionicons } from '@expo/vector-icons';
import { RoomSheet } from './RoomSheet';
import { useState } from 'react';
import { Platform, Share, Pressable, Text, View } from 'react-native';
import Svg, { Rect, Path } from 'react-native-svg';
import * as Clipboard from 'expo-clipboard';
import { invitationLink, tableInvitationCode } from '../multiplayer/invitations';
import { fonts, useTheme } from '../theme';
import { useTranslation } from 'react-i18next';

export function ShareLink({ roomId, matchId, compact = false, menu = false, disabled = false, label }: { label?: string; roomId: string; matchId?: string; compact?: boolean; menu?: boolean; disabled?: boolean }) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const [notice, setNotice] = useState('');
  const [showLink, setShowLink] = useState(false);
  const kind = matchId ? 'game' : 'room';
  const base = Platform.OS === 'web' ? globalThis.location.href : process.env.EXPO_PUBLIC_WEB_URL || 'https://bhidne-ho.lfactorial.com/';
  const url = invitationLink(base, { roomId, matchId });
  async function copy() {
    if (disabled) return;
    try {
      if (!await Clipboard.setStringAsync(url)) throw new Error('Copy unavailable');
      setShowLink(false); setNotice(t('common.copied'));
    } catch { setShowLink(true); setNotice(t('common.copyFallback')); }
  }
  return <View style={{ gap: 4, paddingHorizontal: compact || menu ? 0 : 8 }}>
    <Pressable accessibilityRole="button" accessibilityLabel={label || (menu ? 'Copy Invite Link' : t(kind === 'game' ? 'common.copyGameLink' : 'common.copyRoomLink'))}
      disabled={disabled} accessibilityState={{ disabled }} onPress={() => void copy()} style={{ opacity: disabled ? 0.55 : 1, minWidth: 44, minHeight: 44, alignSelf: menu ? 'stretch' : 'flex-start', flexDirection: 'row', alignItems: 'center', justifyContent: menu ? 'flex-start' : 'center', gap: 8, paddingVertical: 10, paddingHorizontal: menu ? 0 : compact ? 8 : 10 }}>
      <Svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={menu ? colors.textMuted : colors.accent} strokeWidth={1.8} accessible={false}>
        <Path strokeLinecap="round" strokeLinejoin="round" d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-2 2M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l2-2" />
      </Svg>
      {!compact && <Text style={{ color: menu ? (disabled ? colors.textMuted : colors.text) : colors.accent, fontFamily: menu ? fonts.medium : fonts.body, fontSize: 14 }}>{label || (menu ? 'Copy Invite Link' : t('common.copyLink'))}</Text>}
    </Pressable>
    {showLink && !disabled && <Text selectable accessibilityLabel={`${kind} invitation link`} style={{ color: colors.textMuted, fontSize: 11 }}>{url}</Text>}
    {(disabled || !!notice) && <Text numberOfLines={menu ? 1 : undefined} accessibilityLiveRegion="polite" style={{ color: colors.textMuted, fontFamily: fonts.body, fontSize: 11 }}>{disabled ? 'Sharing unavailable · table ended' : notice}</Text>}
  </View>;
}

function CopyCode({ value, kind, menu = false, inline = false }: { value: string; kind: 'room' | 'table'; menu?: boolean; inline?: boolean }) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const [notice, setNotice] = useState('');
  const [showCode, setShowCode] = useState(false);
  async function copy() {
    try {
      if (!await Clipboard.setStringAsync(value)) throw new Error('Copy unavailable');
      setShowCode(false); setNotice(t('common.copied'));
    } catch { setShowCode(true); setNotice(t('common.copyFallback')); }
  }
  return <View style={{ gap: 4, paddingHorizontal: menu ? 0 : 8 }}>
    <Pressable accessibilityRole="button" accessibilityLabel={`Copy ${kind} code`} onPress={() => void copy()}
      style={{ minWidth: 44, minHeight: 44, alignSelf: menu ? 'stretch' : 'flex-start', flexDirection: 'row', alignItems: 'center', justifyContent: menu ? 'flex-start' : 'center', gap: 8, paddingVertical: 10, paddingHorizontal: menu ? 0 : 10 }}>
      <Svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={colors.accent} strokeWidth={1.8} accessible={false}>
        <Rect x={8} y={8} width={12} height={13} rx={2} /><Path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h3" />
      </Svg>
      <Text style={{ color: menu ? colors.text : colors.accent, fontFamily: fonts.medium, fontSize: 14 }}>{inline ? value : `Copy ${kind} code`}</Text>
    </Pressable>
    {showCode && <Text selectable accessibilityLabel={`${kind} code ${value}`} style={{ color: colors.textMuted, fontSize: 11 }}>{value}</Text>}
    {!!notice && <Text accessibilityLiveRegion="polite" style={{ color: colors.text, fontSize: 12 }}>{notice}</Text>}
  </View>;
}

export function RoomShareActions({ roomId, menu = false }: { roomId: string; menu?: boolean }) {
  return <View style={{ flexDirection: menu ? 'column' : 'row', flexWrap: 'wrap', gap: menu ? 4 : 12 }}>
    <CopyRoomCode roomId={roomId} menu />
    <ShareLink roomId={roomId} menu label="Copy room link" />
  </View>;
}

export function CopyRoomCode({ roomId, menu = false, inline = false }: { roomId: string; menu?: boolean; inline?: boolean }) {
  return <CopyCode value={roomId} kind="room" menu={menu} inline={inline} />;
}
export function TableShareActions({ roomId, matchId }: { roomId: string; matchId: string }) {
  return <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
    <CopyCode value={tableInvitationCode(roomId, matchId)} kind="table" menu />
    <ShareLink roomId={roomId} matchId={matchId} menu label="Copy table link" />
  </View>;
}

type TableShareProps = { roomId: string; matchId: string; visible: boolean; onClose: () => void };
export function TableShareSheet(props: TableShareProps) {
  return <TableShareContent {...props} />;
}
function TableShareContent({ roomId, matchId, visible, onClose }: TableShareProps) {
  const { colors: c } = useTheme();
  const [error, setError] = useState('');
  async function share() {
    const base = Platform.OS === 'web' ? globalThis.location.href : process.env.EXPO_PUBLIC_WEB_URL || 'https://bhidne-ho.lfactorial.com/';
    const url = invitationLink(base, { roomId, matchId });
    try {
      if (Platform.OS === 'web') {
        if (globalThis.navigator?.share) await globalThis.navigator.share({ title: 'Join my Bhidne Ho table', url });
        else { if (!await Clipboard.setStringAsync(url)) throw new Error('Copy unavailable'); setError('Link copied. Paste it into any messaging app.'); }
      } else await Share.share({ message: url, ...(Platform.OS === 'ios' ? { url } : {}) });
    } catch (failure) { if ((failure as Error).name !== 'AbortError') setError('Could not share. Use the copy options above.'); }
  }
  return <RoomSheet visible={visible} title="Share table" closeLabel="Close table sharing" onClose={onClose}>
    <TableShareActions roomId={roomId} matchId={matchId} />
    <Pressable accessibilityRole="button" accessibilityLabel="Share table invitation" onPress={() => void share()} style={{ minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 10 }}><Ionicons name="share-outline" size={20} color={c.accent} /><Text style={{ color: c.accent, fontFamily: fonts.medium }}>Share…</Text></Pressable>
    {!!error && <Text accessibilityLiveRegion="polite" style={{ color: c.textMuted }}>{error}</Text>}
  </RoomSheet>;
}
