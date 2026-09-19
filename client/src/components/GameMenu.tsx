import { type ReactNode, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { fonts, useTheme } from '../theme';
import type { RoomSnapshot } from '../screens/LiveGameTable';
import { ShareLink } from './ShareLink';
import { LanguageToggle } from './LanguageToggle';
import { ThemeToggle } from './ThemeToggle';

export function GameMenu({ snapshot, close, rules, history, poke, canPoke, back, tableControl, leaveControl, endControl, gameActions, gameContent, pokePlayer }: {
  snapshot: RoomSnapshot; close: () => void; rules?: () => void; history?: () => void; poke: () => void;
  gameActions?: { label: string; action: () => void }[]; gameContent?: ReactNode; pokePlayer?: (id: number) => void;
  canPoke: boolean; back: () => void; tableControl?: ReactNode; leaveControl?: ReactNode; endControl?: ReactNode;
}) {
  const { colors } = useTheme();
  const ended = snapshot.status === 'ended' || snapshot.table?.phase === 'ENDED';
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
    {playersOpen && <View style={{ gap: 8 }} testID={`${snapshot.game_type}-menu-players`}>
      {snapshot.players?.map(player => <Text key={player.player_id} style={{ color: colors.text, fontFamily: fonts.body }}>
        {player.display_name}{String(player.player_id) === String(snapshot.your_player_id) ? ' · You' : ''}
      </Text>)}
      <Text style={{ color: colors.textMuted }}>{snapshot.table?.queue.length || 0} waiting</Text>
      {snapshot.table?.current_user.is_queued && <Text style={{ color: colors.textMuted }}>Your waitlist position: {snapshot.table.current_user.queue_position}</Text>}
      {!!snapshot.your_player_id && pokePlayer && snapshot.players?.filter(player => player.player_id !== snapshot.your_player_id).map(player =>
        <View key={player.player_id}>{row(`Poke ${player.display_name || `Player ${player.player_id}`}`, () => open(() => pokePlayer(player.player_id)), !canPoke || ended || player.connected === false)}</View>)}
      {!ended && tableControl}
    </View>}
    {!!snapshot.your_player_id && row('Poke the table', () => open(poke), !canPoke || ended)}
    {section('GAME')}
    {history && row('Bet history', () => open(history))}
    {rules && row('Rules', () => open(rules))}
    {gameActions?.map(item => <View key={item.label}>{row(item.label, () => open(item.action))}</View>)}
    {gameContent}
    {section('ROOM')}
    {snapshot.room_id && <ShareLink roomId={snapshot.room_id} matchId={snapshot.match_id} menu disabled={ended} />}
    {row('Back to room', () => open(back))}
    {section('PREFERENCES')}
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 48 }}>
      <Text style={{ color: colors.text, fontFamily: fonts.body }}>Language</Text><LanguageToggle />
    </View>
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 48 }}>
      <Text style={{ color: colors.text, fontFamily: fonts.body }}>Appearance</Text><ThemeToggle />
    </View>
    <View style={{ marginTop: 'auto', paddingTop: 16 }}>
      <View style={{ borderTopWidth: 1, borderColor: colors.border, paddingTop: 8 }}>{ended ? <>{row(snapshot.game_type === 'flush' ? 'End table' : 'End game', () => {}, true)}{row('Leave Table', () => {}, true)}</> : <>{endControl}{leaveControl}</>}</View>
    </View>
  </>;
}

export function GameMenuMetadata({ snapshot }: { snapshot: RoomSnapshot }) {
  const { colors } = useTheme();
  return <View style={{ gap: 4, paddingBottom: 8 }}>
    <Text selectable style={{ color: colors.textMuted, fontFamily: fonts.body }}>{snapshot.room_id}</Text>
    <Text style={{ color: colors.textMuted, fontFamily: fonts.body }}>{snapshot.table?.seated_players.length ?? snapshot.players?.length ?? 0}/{snapshot.table?.max_players ?? snapshot.capacity} players · {snapshot.table?.phase.toLowerCase() || snapshot.status}</Text>
  </View>;
}
