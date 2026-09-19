import { Pressable, Text, View } from 'react-native';
import { GameIcon } from './BrandArt';
import { fonts, useTheme } from '../theme';
import { tableEntry, tablePhase, type TableEntry, type TableSummary } from '../multiplayer/tableNavigation';
export function TableCard({ table, busy, enter }: { table: TableSummary; busy: boolean; enter: (action: TableEntry) => void }) {
  const { colors: c } = useTheme();
  const primary = tableEntry(table), me = table.current_user;
  const button = (label: string, action: TableEntry, main = false) => <Pressable accessibilityRole="button" accessibilityLabel={`${label} · ${table.name}`} disabled={busy} accessibilityState={{ disabled: busy }} onPress={() => enter(action)}
    style={{ minHeight: 48, paddingHorizontal: 18, justifyContent: 'center', alignItems: 'center', borderRadius: 10, backgroundColor: main ? c.primary : c.surfaceRaised, opacity: busy ? 0.5 : 1 }}>
    <Text style={{ fontFamily: fonts.medium, color: main ? c.onPrimary : c.text }}>{label}</Text>
  </Pressable>;
  return <View testID={`table-card-${table.match_id}`} style={{ padding: 20, gap: 14, borderRadius: 16, backgroundColor: c.surface, marginBottom: 12 }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}><GameIcon game={table.game_type} /><View style={{ flex: 1 }}>
      <Text style={{ fontFamily: fonts.medium, color: c.text, fontSize: 18 }}>{table.name}</Text>
      <Text style={{ fontFamily: fonts.body, color: c.textMuted }}>{({ callbreak: 'Call Break', marriage: 'Marriage', flush: 'Flush' })[table.game_type]} · {table.players}/{table.capacity} seated · {tablePhase(table)}</Text>
    </View></View>
    {!!table.seated_players?.length && <Text style={{ fontFamily: fonts.body, color: c.text }}>{table.seated_players.map(p => p.display_name).join(' · ')}</Text>}
    {!!table.queue_size && <Text style={{ color: c.textMuted, fontFamily: fonts.body }}>{me?.is_queued ? `Queue #${me.queue_position}` : `${table.queue_size} waiting`}</Text>}
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {button(primary.label, primary.action, true)}
      {primary.action !== 'watch' && button('Watch', 'watch')}
      {primary.action === 'watch' && !me?.is_queued && !me?.is_seated && me?.can_queue && table.phase !== 'ENDED' && button('Join queue', 'queue')}
    </View>
  </View>;
}
