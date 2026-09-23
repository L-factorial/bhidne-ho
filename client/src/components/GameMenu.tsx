import { Ionicons } from '@expo/vector-icons';
import { useTableSocial } from './TableSocial';
import { type ReactNode, useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { fonts, useTheme } from '../theme';
import type { RoomSnapshot } from '../screens/LiveGameTable';
import { TableShareSheet } from './ShareLink';
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
  const seated = snapshot.table ? snapshot.table.current_user.is_seated : !!snapshot.your_player_id;
  const playing = snapshot.table ? ['LOCKED', 'STARTED'].includes(snapshot.table.phase) : snapshot.status === 'playing';
  const canShare = !ended && !(seated && playing);
  const [sharing, setSharing] = useState(false);
  useEffect(() => { if (!canShare) setSharing(false); }, [canShare]);
  const [playersOpen, setPlayersOpen] = useState(false);
  const section = (label: string) => <Text style={{ color: colors.textMuted, fontFamily: fonts.body, fontSize: 11,
    marginTop: 12, marginBottom: 4 }}>{label}</Text>;
  const row = (label: string, action: () => void, disabled = false, expanded?: boolean, value?: string) => <Pressable accessibilityRole="button"
    accessibilityLabel={value ? `${label}, ${value}` : label} accessibilityState={{ disabled, ...(expanded === undefined ? {} : { expanded }) }} disabled={disabled}
    onPress={action} style={({ pressed }) => ({ minHeight: 52, paddingVertical: 10, paddingHorizontal: 8, marginHorizontal: -8,
      borderRadius: 12, flexDirection: 'row', gap: 12, alignItems: 'center', justifyContent: 'space-between',
      backgroundColor: pressed ? colors.surfaceRaised : 'transparent', opacity: disabled ? 0.55 : 1 })}>
    <Ionicons name={label.includes('Players') ? 'people-outline' : label.includes('Chat') ? 'chatbubble-outline' : label.includes('Rules') ? 'document-text-outline' : label.includes('history') ? 'receipt-outline' : label.includes('Share') ? 'share-outline' : label.includes('Language') ? 'language-outline' : label.includes('Back') ? 'arrow-back-outline' : 'options-outline'} size={19} color={colors.textMuted} />
    <Text style={{ flex: 1, flexShrink: 1, color: disabled ? colors.textMuted : colors.text, fontFamily: fonts.medium, fontSize: 14 }}>{label}</Text>
    {value ? <Text style={{ color: colors.textMuted, fontFamily: fonts.body, fontSize: 13 }}>{value}</Text>
      : <Ionicons name={expanded === undefined ? 'chevron-forward' : expanded ? 'chevron-up' : 'chevron-down'} size={16} color={colors.textMuted} />}
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
      {!!snapshot.your_player_id && row('Poke the table', () => open(poke), !canPoke || ended)}
      {!ended && tableControl}
    </View>}

    {section('Game')}
    {history && row('Bet history', () => open(history))}
    {rules && row('Rules', () => open(rules))}
    {gameActions?.map(item => <View key={item.label}>{row(item.label, () => open(item.action))}</View>)}
    {gameContent}
    {section('Room')}
    {canShare && snapshot.room_id && snapshot.match_id && <>{row('Share table', () => setSharing(true))}<TableShareSheet roomId={snapshot.room_id} matchId={snapshot.match_id} visible={sharing} onClose={() => setSharing(false)} /></>}
    {row('Back to room', () => open(back))}
    {section('Preferences')}
    {row('Language', () => setLanguage(language === 'en' ? 'ne' : 'en'), false, undefined, language === 'ne' ? 'नेपाली' : 'English')}
    <View style={{ marginTop: 12, paddingTop: 8, borderTopWidth: 1, borderColor: colors.borderSubtle }}>
      <View style={{ paddingTop: 8 }}>{ended ? <>{row(snapshot.game_type === 'flush' ? 'End table' : 'End game', () => {}, true)}{row('Leave Table', () => {}, true)}</> : <>{leaveControl}{endControl}</>}</View>
    </View>
  </>;
}

export function GameMenuMetadata({ snapshot }: { snapshot: RoomSnapshot }) {
  const { colors } = useTheme();
  return <View style={{ gap: 5, paddingTop: 8, paddingBottom: 8 }}>
    <Text style={{ color: colors.textMuted, fontFamily: fonts.body, fontSize: 12 }}>{({ callbreak: 'Call Break', marriage: 'Marriage', flush: 'Flush' })[snapshot.game_type || 'callbreak']} · {snapshot.table?.phase || snapshot.status.toUpperCase()} · {snapshot.table?.seated_players.length ?? snapshot.players?.length ?? 0}/{snapshot.table?.max_players ?? snapshot.capacity} players</Text>
  </View>;
}
