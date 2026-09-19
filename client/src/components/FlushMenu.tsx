import { type ReactNode, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { fonts, useTheme } from '../theme';
import type { RoomSnapshot } from '../screens/LiveGameTable';
import { ShareLink } from './ShareLink';
import { LanguageToggle } from './LanguageToggle';
import { ThemeToggle } from './ThemeToggle';

export function FlushMenu({ snapshot, close, rules, history, poke, canPoke, back, tableControl, leaveControl, endControl }: {
  snapshot: RoomSnapshot; close: () => void; rules: () => void; history: () => void; poke: () => void;
  canPoke: boolean; back: () => void; tableControl?: ReactNode; leaveControl?: ReactNode; endControl?: ReactNode;
}) {
  const { colors } = useTheme();
  const [playersOpen, setPlayersOpen] = useState(false);
  const section = (label: string) => <Text style={{ color: colors.textMuted, fontFamily: fonts.medium, fontSize: 11, letterSpacing: 1.5,
    borderTopWidth: 1, borderColor: colors.border, paddingTop: 16, marginTop: 12, marginBottom: 4 }}>{label}</Text>;
  const row = (label: string, action: () => void, disabled = false, expanded?: boolean) => <Pressable accessibilityRole="button"
    accessibilityLabel={label} accessibilityState={{ disabled, ...(expanded === undefined ? {} : { expanded }) }} disabled={disabled}
    onPress={action} style={{ minHeight: 46, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', opacity: disabled ? 0.45 : 1 }}>
    <Text style={{ color: colors.text, fontFamily: fonts.medium, fontSize: 14 }}>{label}</Text>
    <Text style={{ color: colors.textMuted }}>{expanded === undefined ? '›' : expanded ? '−' : '+'}</Text>
  </Pressable>;
  const open = (action: () => void) => { close(); action(); };
  return <>
    {section('TABLE')}
    {row('Players & waiting queue', () => setPlayersOpen(value => !value), false, playersOpen)}
    {playersOpen && <View style={{ gap: 8 }} testID="flush-menu-players">
      {snapshot.players?.map(player => <Text key={player.player_id} style={{ color: colors.text, fontFamily: fonts.body }}>
        {player.display_name}{String(player.player_id) === String(snapshot.your_player_id) ? ' · You' : ''}
      </Text>)}
      <Text style={{ color: colors.textMuted }}>{snapshot.table?.queue.length || 0} waiting</Text>
      {snapshot.table?.current_user.is_queued && <Text style={{ color: colors.textMuted }}>Your waitlist position: {snapshot.table.current_user.queue_position}</Text>}
      {tableControl}
    </View>}
    {!!snapshot.your_player_id && row('Poke the table', () => open(poke), !canPoke)}
    {section('GAME')}
    {row('Bet history', () => open(history))}
    {row('Rules', () => open(rules))}
    {section('ROOM')}
    {snapshot.room_id && <ShareLink roomId={snapshot.room_id} matchId={snapshot.match_id} menu />}
    {row('Back to room', () => open(back))}
    {section('PREFERENCES')}
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 48 }}>
      <Text style={{ color: colors.text, fontFamily: fonts.body }}>Language</Text><LanguageToggle />
    </View>
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 48 }}>
      <Text style={{ color: colors.text, fontFamily: fonts.body }}>Appearance</Text><ThemeToggle />
    </View>
    <View style={{ marginTop: 'auto', paddingTop: 16 }}>
      <View style={{ borderTopWidth: 1, borderColor: colors.border, paddingTop: 8 }}>{endControl}{leaveControl}</View>
    </View>
  </>;
}
