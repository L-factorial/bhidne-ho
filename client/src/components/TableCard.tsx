import { useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { Pressable, Text, View } from 'react-native';
import { TableShareSheet } from './ShareLink';
import { fonts, radii, space, typography, useTheme } from '../theme';
import { tableEntry, tablePhase, type TableEntry, type TableSummary } from '../multiplayer/tableNavigation';

export function TableCard({ table, roomId, busy, enter }: { roomId: string; table: TableSummary; busy: boolean; enter: (action: TableEntry) => void }) {
  const { colors: c } = useTheme();
  const [sharing, setSharing] = useState(false);
  const primary = tableEntry(table), me = table.current_user;
  const actionLabel = me?.is_seated ? 'Return' : primary.action === 'seat' ? 'Join' : primary.label;
  const players = table.seated_players || [];
  const ended = table.status === 'ended' || table.phase === 'ENDED';
  const secondary = (label: string, action: TableEntry) => <Pressable accessibilityRole="button" accessibilityLabel={`${label} · ${table.name}`} disabled={busy} accessibilityState={{ disabled: busy }} onPress={() => enter(action)} style={{ minHeight: 44, paddingHorizontal: 12, justifyContent: 'center' }}><Text style={{ color: c.accent, fontFamily: fonts.medium }}>{label}</Text></Pressable>;
  return <View testID={`table-card-${table.match_id}`} style={{ borderRadius: radii.large, backgroundColor: c.surface, borderWidth: 1, borderColor: c.borderSubtle, marginBottom: space.md, overflow: 'hidden', opacity: busy ? 0.55 : 1 }}>
    <Pressable accessibilityRole="button" accessibilityLabel={`${primary.label} · ${table.name}`} disabled={busy} accessibilityState={{ disabled: busy }} onPress={() => enter(primary.action)} style={({ pressed }) => ({ padding: space.lg, gap: space.md, backgroundColor: pressed ? c.surfaceRaised : c.surface })}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <View style={{ flex: 1, minWidth: 0, gap: 4 }}><Text numberOfLines={2} style={{ color: c.text, fontFamily: fonts.medium, fontSize: typography.cardTitle }}>{table.name}</Text><Text style={{ color: c.textMuted, fontFamily: fonts.body, fontSize: typography.metadata }}>{({ callbreak: 'Call Break', marriage: 'Marriage', flush: 'Flush' })[table.game_type]} · {table.players}/{table.capacity} seated</Text></View>
        <View style={{ backgroundColor: table.phase === 'STARTED' ? c.successSurface : c.surfaceRaised, paddingHorizontal: 10, paddingVertical: 6, borderRadius: radii.medium }}><Text style={{ color: table.phase === 'STARTED' ? c.success : c.textMuted, fontFamily: fonts.medium, fontSize: typography.caption }}>{tablePhase(table)}</Text></View>
      </View>
      <View testID={`table-preview-${table.match_id}`} style={{ height: 72, backgroundColor: c.tableGreen, borderRadius: radii.xl, borderWidth: 3, borderColor: '#70533B', justifyContent: 'center', alignItems: 'center', flexDirection: 'row', gap: 10 }}>
        {players.slice(0, 5).map(player => <View key={player.seat_id} style={{ width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: c.surfaceRaised, borderWidth: 1, borderColor: c.tableTrim }}><Text style={{ fontFamily: fonts.medium, color: c.text }}>{player.display_name.trim().slice(0, 1).toUpperCase() || '•'}</Text></View>)}
        {!players.length && <Text style={{ color: c.onTableHeader, fontFamily: fonts.body }}>Waiting for players</Text>}
        {players.length > 5 && <Text style={{ color: c.onTableHeader }}>+{players.length - 5}</Text>}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}><Text numberOfLines={1} style={{ flex: 1, color: c.textMuted, fontFamily: fonts.body, fontSize: typography.caption }}>{players.slice(0, 3).map(p => p.display_name).join(' · ')}{players.length > 3 ? ` · +${players.length - 3}` : ''}</Text><Text style={{ color: c.primary, fontFamily: fonts.medium, fontSize: typography.body }}>{actionLabel} →</Text></View>
      {!!table.queue_size && <Text style={{ color: c.textMuted, fontFamily: fonts.body, fontSize: typography.caption }}>{me?.is_queued ? `Queue #${me.queue_position}` : `${table.queue_size} waiting`}</Text>}
    </Pressable>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', borderTopWidth: 1, borderColor: c.borderSubtle, paddingHorizontal: 4 }}>
      {!ended && <Pressable accessibilityRole="button" accessibilityLabel={`Share ${table.name}`} onPress={() => setSharing(true)} style={{ minHeight: 44, paddingHorizontal: 12, flexDirection: 'row', gap: 6, alignItems: 'center' }}><Ionicons name="share-outline" size={17} color={c.accent} /><Text style={{ color: c.accent, fontFamily: fonts.medium }}>Share</Text></Pressable>}
      {primary.action !== 'watch' && secondary('Watch', 'watch')}
      {primary.action === 'watch' && !me?.is_queued && !me?.is_seated && me?.can_queue && !ended && secondary('Join queue', 'queue')}
    </View>
    <TableShareSheet roomId={roomId} matchId={table.match_id} visible={sharing} onClose={() => setSharing(false)} />
  </View>;
}
