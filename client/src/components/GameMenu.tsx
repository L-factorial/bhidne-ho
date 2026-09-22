import { useTableSocial } from './TableSocial';
import { type ReactNode, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { fonts, useTheme } from '../theme';
import type { RoomSnapshot } from '../screens/LiveGameTable';
import { ShareLink } from './ShareLink';
import { useLanguage } from '../i18n/LanguageProvider';

export function GameMenu({ snapshot, close, rules, history, poke, canPoke, back, tableControl, leaveControl, endControl, gameActions, gameContent, pokePlayer }: {
  snapshot: RoomSnapshot; close: () => void; rules?: () => void; history?: () => void; poke: () => void;
  gameActions?: { label: string; action: () => void }[]; gameContent?: ReactNode; pokePlayer?: (id: number) => void;
  canPoke: boolean; back: () => void; tableControl?: ReactNode; leaveControl?: ReactNode; endControl?: ReactNode;
}) {
  const tableSocial = useTableSocial();
  const { colors } = useTheme();
  const { language, setLanguage } = useLanguage();
  const ended = snapshot.status === 'ended' || snapshot.table?.phase === 'ENDED';
  const [playersOpen, setPlayersOpen] = useState(false);
  const section = (label: string) => <Text style={{ color: colors.textMuted, fontFamily: fonts.body, fontSize: 11,
    marginTop: 20, marginBottom: 4 }}>{label}</Text>;
  const row = (label: string, action: () => void, disabled = false, expanded?: boolean, value?: string) => <Pressable accessibilityRole="button"
    accessibilityLabel={value ? `${label}, ${value}` : label} accessibilityState={{ disabled, ...(expanded === undefined ? {} : { expanded }) }} disabled={disabled}
    onPress={action} style={({ pressed }) => ({ minHeight: 46, paddingVertical: 10, paddingHorizontal: 8, marginHorizontal: -8,
      borderRadius: 12, flexDirection: 'row', gap: 12, alignItems: 'center', justifyContent: 'space-between',
      backgroundColor: pressed ? colors.surfaceRaised : 'transparent', opacity: disabled ? 0.55 : 1 })}>
    <Text style={{ flexShrink: 1, color: disabled ? colors.textMuted : colors.text, fontFamily: fonts.medium, fontSize: 14 }}>{label}</Text>
    {value ? <Text style={{ color: colors.textMuted, fontFamily: fonts.body, fontSize: 13 }}>{value}</Text>
      : expanded !== undefined && <Text style={{ color: colors.textMuted, fontSize: 16 }}>{expanded ? '−' : '+'}</Text>}
  </Pressable>;
  const open = (action: () => void) => { close(); action(); };
  return <>
    {section('Table')}
    {tableSocial?.canRead && row('Table Chat', () => open(tableSocial.openChat))}
    {row('Players & waiting queue', () => setPlayersOpen(value => !value), false, playersOpen)}
    {playersOpen && <View style={{ gap: 8, padding: 12, backgroundColor: colors.surfaceRaised, borderRadius: 16 }} testID={`${snapshot.game_type}-menu-players`}>
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
    {section('Game')}
    {history && row('Bet history', () => open(history))}
    {rules && row('Rules', () => open(rules))}
    {gameActions?.map(item => <View key={item.label}>{row(item.label, () => open(item.action))}</View>)}
    {gameContent}
    {section('Room')}
    {snapshot.room_id && <ShareLink roomId={snapshot.room_id} matchId={snapshot.match_id} menu disabled={ended} />}
    {row('Back to room', () => open(back))}
    {section('Preferences')}
    {row('Language', () => setLanguage(language === 'en' ? 'ne' : 'en'), false, undefined, language === 'ne' ? 'नेपाली' : 'English')}
    <View style={{ marginTop: 'auto', paddingTop: 16 }}>
      <View style={{ paddingTop: 8 }}>{ended ? <>{row(snapshot.game_type === 'flush' ? 'End table' : 'End game', () => {}, true)}{row('Leave Table', () => {}, true)}</> : <>{endControl}{leaveControl}</>}</View>
    </View>
  </>;
}

export function GameMenuMetadata({ snapshot }: { snapshot: RoomSnapshot }) {
  const { colors } = useTheme();
  return <View style={{ gap: 5, paddingTop: 4, paddingBottom: 8 }}>
    <Text style={{ color: colors.textMuted, fontFamily: fonts.body, fontSize: 12 }}>{snapshot.table?.seated_players.length ?? snapshot.players?.length ?? 0}/{snapshot.table?.max_players ?? snapshot.capacity} players · {snapshot.table?.phase.toLowerCase() || snapshot.status}</Text>
    <Text selectable numberOfLines={1} accessibilityLabel={`Room ID: ${snapshot.room_id}`} style={{ color: colors.textMuted, fontFamily: fonts.body, fontSize: 10 }}>Room · {snapshot.room_id}</Text>
  </View>;
}
