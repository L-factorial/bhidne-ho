import { useState } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import Svg, { Rect, Path } from 'react-native-svg';
import * as Clipboard from 'expo-clipboard';
import { invitationLink } from '../multiplayer/invitations';
import { useTheme } from '../theme';
import { useTranslation } from 'react-i18next';

export function ShareLink({ roomId, matchId, compact = false, menu = false, disabled = false }: { roomId: string; matchId?: string; compact?: boolean; menu?: boolean; disabled?: boolean }) {
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
    <Pressable accessibilityRole="button" accessibilityLabel={menu ? 'Copy Invite Link' : t(kind === 'game' ? 'common.copyGameLink' : 'common.copyRoomLink')}
      disabled={disabled} accessibilityState={{ disabled }} onPress={() => void copy()} style={{ opacity: disabled ? 0.45 : 1, minWidth: 44, minHeight: 44, alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, padding: compact ? 8 : 10 }}>
      <Svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={colors.accent} strokeWidth={1.8} accessible={false}>
        <Rect x={8} y={8} width={12} height={13} rx={2} /><Path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h3" />
      </Svg>
      {!compact && <Text style={{ color: colors.accent }}>{menu ? 'Copy Invite Link' : t('common.copyLink')}</Text>}
    </Pressable>
    {showLink && !disabled && <Text selectable accessibilityLabel={`${kind} invitation link`} style={{ color: colors.textMuted, fontSize: 11 }}>{url}</Text>}
    {(menu || !!notice) && <Text numberOfLines={menu ? 1 : undefined} accessibilityLiveRegion="polite" style={{ color: colors.text, fontSize: 12, ...(menu ? { minHeight: 16 } : {}) }}>{disabled ? 'Sharing unavailable · table ended' : notice}</Text>}
  </View>;
}

export function CopyRoomCode({ roomId }: { roomId: string }) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const [notice, setNotice] = useState('');
  const [showCode, setShowCode] = useState(false);
  async function copy() {
    try {
      if (!await Clipboard.setStringAsync(roomId)) throw new Error('Copy unavailable');
      setShowCode(false); setNotice(t('common.copied'));
    } catch { setShowCode(true); setNotice(t('common.copyFallback')); }
  }
  return <View style={{ gap: 4, paddingHorizontal: 8 }}>
    <Pressable accessibilityRole="button" accessibilityLabel="Copy room code" onPress={() => void copy()}
      style={{ minWidth: 44, minHeight: 44, alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 10 }}>
      <Svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={colors.accent} strokeWidth={1.8} accessible={false}>
        <Rect x={8} y={8} width={12} height={13} rx={2} /><Path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h3" />
      </Svg>
      <Text style={{ color: colors.accent }}>Copy room code</Text>
    </Pressable>
    {showCode && <Text selectable accessibilityLabel={`Room code ${roomId}`} style={{ color: colors.textMuted, fontSize: 11 }}>{roomId}</Text>}
    {!!notice && <Text accessibilityLiveRegion="polite" style={{ color: colors.text, fontSize: 12 }}>{notice}</Text>}
  </View>;
}
