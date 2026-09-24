import { meldLabel, gameLabel, phaseLabel } from '../i18n/display';
import { ui } from '../i18n/copy.ts';
import { useUiLanguage } from '../i18n/useUiLanguage';
import { Ionicons } from '@expo/vector-icons';
import { useTableSocial } from './TableSocial';
import { type ReactNode, type ComponentProps, useState } from 'react';
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
  const uiLanguage = useUiLanguage();
  const tableSocial = useTableSocial();
  const { colors } = useTheme();
  const { language, setLanguage } = useLanguage();
  const ended = snapshot.status === 'ended' || snapshot.table?.phase === 'ENDED';
  const [sharing, setSharing] = useState(false);
  const [playersOpen, setPlayersOpen] = useState(false);
  const section = (label: string) => <Text style={{ color: colors.textMuted, fontFamily: fonts.body, fontSize: 11,
    marginTop: 12, marginBottom: 4 }}>{label}</Text>;
  const row = (label: string, action: () => void, disabled = false, expanded?: boolean, value?: string, icon: ComponentProps<typeof Ionicons>['name'] = 'options-outline') => <Pressable accessibilityRole="button"
    accessibilityLabel={value ? `${label}, ${value}` : label} accessibilityState={{ disabled, ...(expanded === undefined ? {} : { expanded }) }} disabled={disabled}
    onPress={action} style={({ pressed }) => ({ minHeight: 52, paddingVertical: 10, paddingHorizontal: 8, marginHorizontal: -8,
      borderRadius: 12, flexDirection: 'row', gap: 12, alignItems: 'center', justifyContent: 'space-between',
      backgroundColor: pressed ? colors.surfaceRaised : 'transparent', opacity: disabled ? 0.55 : 1 })}>
    <Ionicons name={icon} size={19} color={colors.textMuted} />
    <Text style={{ flex: 1, flexShrink: 1, color: disabled ? colors.textMuted : colors.text, fontFamily: fonts.medium, fontSize: 14 }}>{label}</Text>
    {value ? <Text style={{ color: colors.textMuted, fontFamily: fonts.body, fontSize: 13 }}>{value}</Text>
      : <Ionicons name={expanded === undefined ? 'chevron-forward' : expanded ? 'chevron-up' : 'chevron-down'} size={16} color={colors.textMuted} />}
  </Pressable>;
  const open = (action: () => void) => { close(); action(); };
  return <>
    {section(ui("common.table"))}
    {tableSocial?.canRead && row(ui("common.table_chat"), () => open(tableSocial.openChat), false, undefined, undefined, 'chatbubble-outline')}
    {row(ui("common.players_waiting_queue"), () => setPlayersOpen(value => !value), false, playersOpen, undefined, 'people-outline')}
    {playersOpen && <View style={{ gap: 8, padding: 12, backgroundColor: colors.surfaceRaised, borderRadius: 16 }} testID={`${snapshot.game_type}-menu-players`}>
      {snapshot.players?.map(player => <Text key={player.player_id} style={{ color: colors.text, fontFamily: fonts.body }}>
        {player.display_name}{String(player.player_id) === String(snapshot.your_player_id) ? ' · You' : ''}
      </Text>)}
      <Text style={{ color: colors.textMuted }}>{ui("common.count_waiting", { "count": snapshot.table?.queue.length || 0 })}</Text>
      {snapshot.table?.current_user.is_queued && <Text style={{ color: colors.textMuted }}>{ui("rooms.your_waitlist_position_position", { "position": snapshot.table.current_user.queue_position })}</Text>}
      {!!snapshot.your_player_id && pokePlayer && snapshot.players?.filter(player => player.player_id !== snapshot.your_player_id).map(player =>
        <View key={player.player_id}>{row(ui("social.poke_player_2", { "player": player.display_name || `Player ${player.player_id}` }), () => open(() => pokePlayer(player.player_id)), !canPoke || ended || player.connected === false)}</View>)}
      {!!snapshot.your_player_id && row(ui("social.poke_the_table"), () => open(poke), !canPoke || ended)}
      {!ended && tableControl}
    </View>}

    {section(ui("common.game"))}
    {history && row(ui("flush.bet_history"), () => open(history), false, undefined, undefined, 'receipt-outline')}
    {rules && row(ui("common.rules"), () => open(rules), false, undefined, undefined, 'document-text-outline')}
    {gameActions?.map(item => <View key={item.label}>{row(item.label, () => open(item.action))}</View>)}
    {gameContent}
    {section(ui("common.room"))}
    {snapshot.room_id && snapshot.match_id && <>{row(ui("rooms.share_table"), () => setSharing(true), ended, undefined, undefined, 'share-outline')}<TableShareSheet roomId={snapshot.room_id} matchId={snapshot.match_id} visible={sharing} onClose={() => setSharing(false)} /></>}
    {row(ui("common.back_to_room"), () => open(back), false, undefined, undefined, 'arrow-back-outline')}
    {section(ui("common.preferences"))}
    {row(ui("common.language"), () => setLanguage(language === 'en' ? 'ne' : 'en'), false, undefined, language === 'ne' ? 'नेपाली' : ui("common.english"), 'language-outline')}
    <View style={{ marginTop: 12, paddingTop: 8, borderTopWidth: 1, borderColor: colors.borderSubtle }}>
      <View style={{ paddingTop: 8 }}>{ended ? <>{row(snapshot.game_type === 'flush' ? ui("rooms.end_table") : ui("rooms.end_game"), () => {}, true)}{row(ui("rooms.leave_table"), () => {}, true)}</> : <>{leaveControl}{endControl}</>}</View>
    </View>
  </>;
}

export function GameMenuMetadata({ snapshot }: { snapshot: RoomSnapshot }) {
  const uiLanguage = useUiLanguage();
  const { colors } = useTheme();
  return <View style={{ gap: 5, paddingTop: 8, paddingBottom: 8 }}>
    <Text style={{ color: colors.textMuted, fontFamily: fonts.body, fontSize: 12 }}>{ui("common.game_phase_seated_capacity_players", { "game": gameLabel(snapshot.game_type || 'callbreak'), "phase": phaseLabel(snapshot.table?.phase || snapshot.status), "seated": snapshot.table?.seated_players.length ?? snapshot.players?.length ?? 0, "capacity": snapshot.table?.max_players ?? snapshot.capacity })}</Text>
  </View>;
}
