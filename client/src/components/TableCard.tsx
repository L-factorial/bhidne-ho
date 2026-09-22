import { TableShareActions } from './ShareLink';
import { Pressable, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { fonts, useTheme } from '../theme';
import { tableEntry, tablePhase, type TableEntry, type TableSummary } from '../multiplayer/tableNavigation';
export function TableCard({ table, roomId, busy, enter }: { roomId: string; table: TableSummary; busy: boolean; enter: (action: TableEntry) => void }) {
  const { colors: c } = useTheme();
  const primary = tableEntry(table), me = table.current_user;
  const button = (label: string, action: TableEntry, main = false) => <Pressable accessibilityRole="button" accessibilityLabel={`${label} · ${table.name}`} disabled={busy} accessibilityState={{ disabled: busy }} onPress={() => enter(action)}
    style={{ minHeight: 48, paddingHorizontal: 18, justifyContent: 'center', alignItems: 'center', borderRadius: 10, backgroundColor: main ? c.primary : c.surfaceRaised, opacity: busy ? 0.5 : 1 }}>
    <Text style={{ fontFamily: fonts.medium, color: main ? c.onPrimary : c.text }}>{label}</Text>
  </Pressable>;
  return <View testID={`table-card-${table.match_id}`} style={{ padding: 16, gap: 12, borderRadius: 20, backgroundColor: c.surface, marginBottom: 12 }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}><View style={{ flex: 1 }}>
      <Text style={{ fontFamily: fonts.medium, color: c.text, fontSize: 17 }}>{table.name}</Text>
      <Text style={{ fontFamily: fonts.body, color: c.textMuted }}>{({ callbreak: 'Call Break', marriage: 'Marriage', flush: 'Flush' })[table.game_type]} · {table.players}/{table.capacity} seated</Text>
    </View><View style={{ backgroundColor: c.surfaceRaised, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20 }}><Text style={{ color: c.accent, fontFamily: fonts.medium, fontSize: 12 }}>{tablePhase(table)}</Text></View></View>
    <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
      <LinearGradient testID={`table-preview-${table.match_id}`} colors={table.game_type === 'marriage' ? ['#84502B', '#422613'] : table.game_type === 'flush' ? ['#155574', '#082B40'] : ['#176443', '#073E2B']} style={{ flex: 1, minHeight: 132, borderRadius: 28, borderWidth: 7, borderColor: table.game_type === 'flush' ? '#283E46' : '#654529', padding: 8, justifyContent: 'center', gap: 8 }}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8 }}>
          {Array.from({ length: table.capacity }, (_, index) => {
            const player = table.seated_players?.[index];
            return <View key={index} accessibilityLabel={player ? player.display_name : 'Empty seat'} style={{ alignItems: 'center', width: 40, gap: 3 }}>
              <View style={{ width: 32, height: 32, borderRadius: 16, borderWidth: 2, borderColor: '#E6D7BA', backgroundColor: player ? '#F6ECD9' : '#244A40', alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: player ? '#263D33' : '#F6ECD9', fontFamily: fonts.medium }}>{player ? player.display_name.trim().slice(0, 1).toUpperCase() : '+'}</Text></View>
              {!!player && <Text numberOfLines={1} style={{ color: '#FFF8EB', fontSize: 10, fontFamily: fonts.body }}>{player.display_name}</Text>}
            </View>;
          })}
        </View>
        <Text accessible={false} style={{ textAlign: 'center', color: '#FFF8EB', fontSize: 22 }}>♠ ♥ ♣ ♦</Text>
      </LinearGradient>
      <View style={{ maxWidth: 108 }}>{button(primary.label, primary.action, true)}</View>
    </View>
    {table.status !== 'ended' && table.phase !== 'ENDED' && <TableShareActions roomId={roomId} matchId={table.match_id} />}
    {!!table.queue_size && <Text style={{ color: c.textMuted, fontFamily: fonts.body }}>{me?.is_queued ? `Queue #${me.queue_position}` : `${table.queue_size} waiting`}</Text>}
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {primary.action !== 'watch' && button('Watch', 'watch')}
      {primary.action === 'watch' && !me?.is_queued && !me?.is_seated && me?.can_queue && table.phase !== 'ENDED' && button('Join queue', 'queue')}
    </View>
  </View>;
}
