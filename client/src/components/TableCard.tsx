import { gameControlFinish, gamePanelFinish, fonts, radii, space, typography, useTheme } from '../theme';
import { Pressable, Text, View } from 'react-native';
import { tableEntry, tablePhase, type TableEntry, type TableSummary } from '../multiplayer/tableNavigation';

export function TableCard({ table, busy, enter, compact = false, roomName }: { compact?: boolean; roomName?: string; roomId: string; table: TableSummary; busy: boolean; enter: (action: TableEntry) => void }) {
  const { colors: c } = useTheme();
  const primary = tableEntry(table), me = table.current_user;
  const actionLabel = me?.is_seated ? 'Return' : primary.action === 'seat' ? 'Take seat' : primary.label;
  const players = table.seated_players || [];
  const ended = table.status === 'ended' || table.phase === 'ENDED';
  const secondary = (label: string, action: TableEntry) => <Pressable accessibilityRole="button" accessibilityLabel={`${label} · ${table.name}`} disabled={busy} accessibilityState={{ disabled: busy }} onPress={() => enter(action)} style={{ minHeight: 44, paddingHorizontal: 12, justifyContent: 'center' }}><Text style={{ color: c.accent, fontFamily: fonts.medium }}>{label}</Text></Pressable>;
  return <View testID={`table-card-${table.match_id}`} style={{ ...gamePanelFinish(c), borderRadius: radii.large, backgroundColor: c.surface, borderWidth: 1, borderColor: c.borderSubtle, marginBottom: space.md, overflow: 'hidden', opacity: busy ? 0.55 : 1 }}>
    <Pressable accessibilityRole="button" accessibilityLabel={`${primary.label} · ${table.name}`} disabled={busy} accessibilityState={{ disabled: busy }} onPress={() => enter(primary.action)} style={({ pressed }) => ({ padding: space.lg, gap: space.md, backgroundColor: pressed ? c.surfaceRaised : c.surface })}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <View style={{ flex: 1, minWidth: 0, gap: 4 }}><Text numberOfLines={2} style={{ color: c.text, fontFamily: fonts.medium, fontSize: typography.cardTitle }}>{table.name}</Text><Text style={{ color: c.textMuted, fontFamily: fonts.body, fontSize: typography.metadata }}>{roomName ? `${roomName} · ` : ''}{({ callbreak: 'Call Break', marriage: 'Marriage', flush: 'Flush' })[table.game_type]} · {table.players}/{table.capacity} seated</Text></View>
        <View style={{ backgroundColor: table.phase === 'STARTED' ? c.successSurface : c.surfaceRaised, paddingHorizontal: 10, paddingVertical: 6, borderRadius: radii.medium }}><Text style={{ color: table.phase === 'STARTED' ? c.success : c.textMuted, fontFamily: fonts.medium, fontSize: typography.caption }}>{tablePhase(table)}</Text></View>
      </View>
      <View testID={`table-preview-${table.match_id}`} style={{ height: compact ? 44 : 72, backgroundColor: compact ? 'transparent' : c.table, borderRadius: radii.xl, borderWidth: compact ? 0 : 3, borderColor: c.tableTrim, justifyContent: compact ? 'flex-start' : 'center', alignItems: 'center', flexDirection: 'row', gap: compact ? 4 : 10 }}>
        {players.slice(0, compact ? 3 : 5).map(player => <View key={player.seat_id} style={{ width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: c.surfaceRaised, borderWidth: 1, borderColor: c.tableTrim }}><Text style={{ fontFamily: fonts.medium, color: c.text }}>{player.display_name.trim().slice(0, 1).toUpperCase() || '•'}</Text></View>)}
        {!players.length && <Text style={{ color: compact ? c.textMuted : c.onTableHeader, fontFamily: fonts.body }}>Waiting for players</Text>}
        {players.length > (compact ? 3 : 5) && <Text style={{ color: compact ? c.textMuted : c.onTableHeader }}>+{players.length - (compact ? 3 : 5)}</Text>}
        {compact && <View style={{ ...gameControlFinish(c), marginLeft: 'auto', minHeight: 44, paddingHorizontal: 12, backgroundColor: c.primary, borderRadius: 10, justifyContent: 'center' }}><Text style={{ color: c.onPrimary, fontFamily: fonts.medium, fontSize: 13 }}>{actionLabel} →</Text></View>}
      </View>
      {!compact && <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}><Text numberOfLines={1} style={{ flex: 1, color: c.textMuted, fontFamily: fonts.body, fontSize: typography.caption }}>{players.slice(0, 3).map(p => p.display_name).join(' · ')}{players.length > 3 ? ` · +${players.length - 3}` : ''}</Text><Text style={{ color: c.accent, fontFamily: fonts.medium, fontSize: typography.body }}>{actionLabel} →</Text></View>}
      {!!table.queue_size && <Text style={{ color: c.textMuted, fontFamily: fonts.body, fontSize: typography.caption }}>{me?.is_queued ? `Queue #${me.queue_position}` : `${table.queue_size} waiting`}</Text>}
    </Pressable>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', borderTopWidth: 1, borderColor: c.borderSubtle, paddingHorizontal: 4 }}>
      {primary.action !== 'watch' && secondary('Watch', 'watch')}
      {primary.action === 'watch' && !me?.is_queued && !me?.is_seated && me?.can_queue && !ended && secondary('Join queue', 'queue')}
    </View>
  </View>;
}
