import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AppText as Text } from './AppText';
import { useTableSocial } from './TableSocial';
import { ui } from '../i18n/copy';
import { useUiLanguage } from '../i18n/useUiLanguage';
import { sessionCountdown, sessionNow } from '../multiplayer/tableSession';
import { fonts, useTheme } from '../theme';
import type { RoomSnapshot } from '../screens/LiveGameTable';

/** Server deadlines remain authoritative; this badge only displays their countdown. */
export function GameSessionClock({ snapshot }: { snapshot: RoomSnapshot }) {
  useUiLanguage();
  const { colors: c } = useTheme();
  const social = useTableSocial();
  const [now, setNow] = useState(sessionNow);
  const session = snapshot.session;
  useEffect(() => {
    if (!session) return;
    setNow(sessionNow());
    const timer = setInterval(() => setNow(sessionNow()), 1000);
    return () => clearInterval(timer);
  }, [!!session]);
  const userId = social?.session?.user_id ?? snapshot.players?.find(player => player.player_id === snapshot.your_player_id)?.user_id ?? '';
  const countdown = sessionCountdown(session, userId, now);
  if (!countdown) return null;
  const player = snapshot.players?.find(player => player.player_id === countdown.seatId)?.display_name
    ?? ui('rooms.seat_seat_player', { seat: countdown.seatId ?? '', player: '' }).trim();
  const label = countdown.waiting ? ui('rooms.session_waiting_server') : countdown.idle ? ui('rooms.session_idle', { time: countdown.time })
    : ui(countdown.warning ? 'rooms.session_action_warning' : 'rooms.session_action', { player, time: countdown.time });
  const color = countdown.warning ? c.danger : c.accent;
  return <View testID="game-session-clock" accessible accessibilityLabel={label} pointerEvents="none"
    style={{ minHeight: 32, flexShrink: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5,
      paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20, borderWidth: 1, borderColor: c.border, backgroundColor: c.background }}>
    <Ionicons name="stopwatch-outline" size={18} color={color} />
    <Text testID="session-countdown" numberOfLines={1} style={{ color, fontFamily: fonts.medium, fontSize: 16, fontVariant: ['tabular-nums'] }}>{countdown.time}</Text>
  </View>;
}
