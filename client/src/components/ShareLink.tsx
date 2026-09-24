import { ui, uiLabel } from '../i18n/copy.ts';
import { useUiLanguage } from '../i18n/useUiLanguage';
import { Ionicons } from '@expo/vector-icons';
import { RoomSheet } from './RoomSheet';
import { useState } from 'react';
import { Platform, Share, Pressable, Text, View } from 'react-native';
import Svg, { Rect, Path } from 'react-native-svg';
import * as Clipboard from 'expo-clipboard';
import { invitationLink, roomInvitationCode, tableInvitationCode } from '../multiplayer/invitations';
import { fonts, useTheme } from '../theme';
import { useTranslation } from 'react-i18next';

export function ShareLink({ roomId, matchId, compact = false, menu = false, disabled = false, label }: { label?: string; roomId: string; matchId?: string; compact?: boolean; menu?: boolean; disabled?: boolean }) {
  const uiLanguage = useUiLanguage();
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
      if (!await Clipboard.setStringAsync(url)) throw new Error(ui("common.copy_unavailable"));
      setShowLink(false); setNotice(t('common.copied'));
    } catch { setShowLink(true); setNotice(t('common.copyFallback')); }
  }
  return <View style={{ gap: 4, paddingHorizontal: compact || menu ? 0 : 8 }}>
    <Pressable accessibilityRole="button" accessibilityLabel={label || (menu ? ui("common.copy_invite_link") : t(kind === 'game' ? 'common.copyGameLink' : 'common.copyRoomLink'))}
      disabled={disabled} accessibilityState={{ disabled }} onPress={() => void copy()} style={{ opacity: disabled ? 0.55 : 1, minWidth: 44, minHeight: 44, alignSelf: menu ? 'stretch' : 'flex-start', flexDirection: 'row', alignItems: 'center', justifyContent: menu ? 'flex-start' : 'center', gap: 8, paddingVertical: 10, paddingHorizontal: menu ? 0 : compact ? 8 : 10 }}>
      <Svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={menu ? colors.textMuted : colors.accent} strokeWidth={1.8} accessible={false}>
        <Path strokeLinecap="round" strokeLinejoin="round" d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-2 2M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l2-2" />
      </Svg>
      {!compact && <Text style={{ color: menu ? (disabled ? colors.textMuted : colors.text) : colors.accent, fontFamily: menu ? fonts.medium : fonts.body, fontSize: 14 }}>{label || (menu ? ui("common.copy_invite_link") : t('common.copyLink'))}</Text>}
    </Pressable>
    {showLink && !disabled && <Text selectable accessibilityLabel={`${kind} invitation link`} style={{ color: colors.textMuted, fontSize: 11 }}>{url}</Text>}
    {(disabled || !!notice) && <Text numberOfLines={menu ? 1 : undefined} accessibilityLiveRegion="polite" style={{ color: colors.textMuted, fontFamily: fonts.body, fontSize: 11 }}>{disabled ? ui("common.sharing_unavailable_table_ended") : notice}</Text>}
  </View>;
}

function CopyCode({ value, kind, menu = false, inline = false }: { value: string; kind: 'room' | 'table'; menu?: boolean; inline?: boolean }) {
  const uiLanguage = useUiLanguage();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const [notice, setNotice] = useState('');
  const [showCode, setShowCode] = useState(false);
  async function copy() {
    try {
      if (!await Clipboard.setStringAsync(value)) throw new Error(ui("common.copy_unavailable"));
      setShowCode(false); setNotice(t('common.copied'));
    } catch { setShowCode(true); setNotice(t('common.copyFallback')); }
  }
  return <View style={{ gap: 4, paddingHorizontal: menu ? 0 : 8 }}>
    <Pressable accessibilityRole="button" accessibilityLabel={ui("common.copy_kind_code", { "kind": uiLabel(kind) })} onPress={() => void copy()}
      style={{ minWidth: 44, minHeight: 44, alignSelf: menu ? 'stretch' : 'flex-start', flexDirection: 'row', alignItems: 'center', justifyContent: menu ? 'flex-start' : 'center', gap: 8, paddingVertical: 10, paddingHorizontal: menu ? 0 : 10 }}>
      <Svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={colors.accent} strokeWidth={1.8} accessible={false}>
        <Rect x={8} y={8} width={12} height={13} rx={2} /><Path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h3" />
      </Svg>
      <Text style={{ color: menu ? colors.text : colors.accent, fontFamily: fonts.medium, fontSize: 14 }}>{inline ? value : ui("common.copy_kind_code", { "kind": uiLabel(kind) })}</Text>
    </Pressable>
    {showCode && <Text selectable accessibilityLabel={ui("common.game_code_code", { "game": uiLabel(kind), "code": value })} style={{ color: colors.textMuted, fontSize: 11 }}>{value}</Text>}
    {!!notice && <Text accessibilityLiveRegion="polite" style={{ color: colors.text, fontSize: 12 }}>{notice}</Text>}
  </View>;
}

export function RoomShareActions({ roomId, menu = false }: { roomId: string; menu?: boolean }) {
  const uiLanguage = useUiLanguage();
  return <View style={{ flexDirection: menu ? 'column' : 'row', flexWrap: 'wrap', gap: menu ? 4 : 12 }}>
    <CopyRoomCode roomId={roomId} menu />
    <ShareLink roomId={roomId} menu label={ui("common.copy_room_link")} />
  </View>;
}

export function CopyRoomCode({ roomId, menu = false, inline = false }: { roomId: string; menu?: boolean; inline?: boolean }) {
  const uiLanguage = useUiLanguage();
  return <CopyCode value={roomInvitationCode(roomId)} kind="room" menu={menu} inline={inline} />;
}
export function TableShareActions({ roomId, matchId }: { roomId: string; matchId: string }) {
  const uiLanguage = useUiLanguage();
  return <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
    <CopyCode value={tableInvitationCode(roomId, matchId)} kind="table" menu />
    <ShareLink roomId={roomId} matchId={matchId} menu label={ui("common.copy_table_link")} />
  </View>;
}

type TableShareProps = { roomId: string; matchId: string; visible: boolean; onClose: () => void };
export function TableShareSheet(props: TableShareProps) {
  const uiLanguage = useUiLanguage();
  return <TableShareContent {...props} />;
}
function TableShareContent({ roomId, matchId, visible, onClose }: TableShareProps) {
  const uiLanguage = useUiLanguage();
  const { colors: c } = useTheme();
  const [error, setError] = useState('');
  async function share() {
    const base = Platform.OS === 'web' ? globalThis.location.href : process.env.EXPO_PUBLIC_WEB_URL || 'https://bhidne-ho.lfactorial.com/';
    const url = invitationLink(base, { roomId, matchId });
    try {
      if (Platform.OS === 'web') {
        if (globalThis.navigator?.share) await globalThis.navigator.share({ title: ui("common.join_my_bhidne_ho_table"), url });
        else { if (!await Clipboard.setStringAsync(url)) throw new Error(ui("common.copy_unavailable")); setError(ui("feedback.link_copied_paste_it_into_any_messaging_app")); }
      } else await Share.share({ message: url, ...(Platform.OS === 'ios' ? { url } : {}) });
    } catch (failure) { if ((failure as Error).name !== 'AbortError') setError(ui("feedback.could_not_share_use_the_copy_options_above")); }
  }
  return <RoomSheet visible={visible} title={ui("rooms.share_table")} closeLabel={ui("common.close_table_sharing")} onClose={onClose}>
    <TableShareActions roomId={roomId} matchId={matchId} />
    <Pressable accessibilityRole="button" accessibilityLabel={ui("rooms.share_table_invitation")} onPress={() => void share()} style={{ minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 10 }}><Ionicons name="share-outline" size={20} color={c.accent} /><Text style={{ color: c.accent, fontFamily: fonts.medium }}>{ui("common.share_2")}</Text></Pressable>
    {!!error && <Text accessibilityLiveRegion="polite" style={{ color: c.textMuted }}>{error}</Text>}
  </RoomSheet>;
}
