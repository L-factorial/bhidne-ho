import { gameControlFinish, fonts, useTheme } from '../theme';
import { useEffect, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { AppState, Pressable, ScrollView, Text, View } from 'react-native';
import { request } from '../multiplayer/api';
import type { Session } from '../multiplayer/session';
import type { TableEntry, TableSummary } from '../multiplayer/tableNavigation';
import { TableCard } from './TableCard';

export type ActiveTable = TableSummary & { room_id: string; room_name: string };
const filters = [['all', 'All'], ['flush', 'Flush'], ['marriage', 'Marriage'], ['callbreak', 'Call Break']] as const;
export function ActiveGames({ session, busy, enter, onBrowseRooms }: { onBrowseRooms: () => void; session: Session; busy: boolean; enter: (table: ActiveTable, action: TableEntry) => void }) {
  const { colors: c } = useTheme();
  const [tables, setTables] = useState<ActiveTable[]>([]);
  const [filter, setFilter] = useState<(typeof filters)[number][0]>('all');
  const [loaded, setLoaded] = useState(false), [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(false), [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let pending = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let cancelDelay: (() => void) | undefined;
    async function load() {
      if (pending || controller.signal.aborted || AppState.currentState === 'background') return;
      pending = true; setRefreshing(true);
      try {
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            const data = await request<ActiveTable[]>('/active-tables', session, undefined, controller.signal);
            if (!controller.signal.aborted) { setTables(data.filter(t => t.status !== 'ended' && t.phase !== 'ENDED')); setLoaded(true); setError(false); }
            return;
          } catch {
            if (controller.signal.aborted) return;
            if (attempt === 2) { setError(true); return; }
            await new Promise<void>(resolve => { cancelDelay = resolve; retryTimer = setTimeout(resolve, attempt ? 2500 : 1500); });
            if (controller.signal.aborted) return;
          }
        }
      } finally { pending = false; if (!controller.signal.aborted) setRefreshing(false); }
    }
    void load();
    const timer = setInterval(() => void load(), 15000);
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') void load(); });
    return () => { controller.abort(); clearInterval(timer); clearTimeout(retryTimer); cancelDelay?.(); subscription.remove(); };
  }, [session.token, refresh]);
  const priority = (table: ActiveTable) => table.current_user?.is_seated ? 0 : table.phase === 'OPEN' && table.current_user?.can_join ? 1 : 2;
  const visible = tables.filter(table => filter === 'all' || table.game_type === filter).sort((a, b) => priority(a) - priority(b) || a.name.localeCompare(b.name) || a.match_id.localeCompare(b.match_id));
  const retry = <Pressable accessibilityRole="button" accessibilityLabel="Retry active games" onPress={() => setRefresh(v => v + 1)} style={{ minHeight: 44, paddingHorizontal: 16, borderRadius: 10, backgroundColor: c.primary, justifyContent: 'center' }}><Text style={{ color: c.onPrimary, fontFamily: fonts.medium }}>Retry</Text></Pressable>;
  return <View testID="active-games" style={{ gap: 14, paddingVertical: 16 }}>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }} accessibilityRole="tablist" accessibilityLabel="Filter active games">
      {filters.map(([value, label]) => <Pressable key={value} accessibilityRole="tab" accessibilityLabel={`${label} games`} accessibilityState={{ selected: filter === value }} onPress={() => setFilter(value)} style={{ ...gameControlFinish(c), minHeight: 44, paddingHorizontal: 14, borderRadius: 22, borderWidth: 1, borderColor: filter === value ? c.primary : c.borderSubtle, backgroundColor: filter === value ? c.primary : c.surface, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Text style={{ color: filter === value ? c.onPrimary : c.textMuted, fontFamily: fonts.medium, fontSize: 13 }}>{label}</Text>
        {loaded && <Text style={{ color: filter === value ? c.onPrimary : c.textMuted, fontSize: 12 }}>{value === 'all' ? tables.length : tables.filter(table => table.game_type === value).length}</Text>}
      </Pressable>)}
    </ScrollView>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <Text accessibilityRole="header" style={{ flex: 1, color: c.text, fontFamily: fonts.medium, fontSize: 18 }}>Available tables</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Refresh active games" disabled={refreshing} accessibilityState={{ disabled: refreshing }} onPress={() => setRefresh(v => v + 1)} style={{ minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center' }}><Ionicons name="refresh-outline" size={20} color={refreshing ? c.textMuted : c.accent} /></Pressable>
    </View>
    {error && <View accessibilityRole="alert" testID="active-games-error" style={{ gap: 12, alignItems: 'flex-start', backgroundColor: c.surface, padding: 20, borderRadius: 18, borderWidth: 1, borderColor: c.borderSubtle }}>
      <Text style={{ color: c.text, fontFamily: fonts.medium }}>{loaded ? 'Couldn’t refresh tables' : 'Couldn’t load tables'}</Text>
      <Text style={{ color: c.textMuted }}>{loaded ? 'Showing the last available tables. Try refreshing again.' : 'Check your connection and try again.'}</Text>{retry}
    </View>}
    {!loaded && !error && <View testID="active-games-loading" accessibilityLabel="Loading active tables" style={{ gap: 12 }}>{[0, 1, 2].map(key => <View key={key} style={{ padding: 16, gap: 12, backgroundColor: c.surface, borderRadius: 18 }}><View style={{ width: '58%', height: 16, borderRadius: 8, backgroundColor: c.surfaceRaised }} /><View style={{ width: '80%', height: 12, borderRadius: 6, backgroundColor: c.surfaceRaised }} /><View style={{ width: '35%', height: 30, borderRadius: 15, backgroundColor: c.surfaceRaised }} /></View>)}</View>}
    {loaded && !error && !visible.length && <View testID="active-games-empty" style={{ alignItems: 'center', gap: 12, padding: 28, backgroundColor: c.surface, borderRadius: 18, borderWidth: 1, borderColor: c.borderSubtle }}>
      <Ionicons name="people-outline" size={32} color={c.accent} />
      <Text style={{ color: c.text, fontFamily: fonts.medium, fontSize: 18, textAlign: 'center' }}>{filter === 'all' ? 'No active tables yet' : `No ${filters.find(([key]) => key === filter)?.[1]} tables yet`}</Text>
      <Text style={{ color: c.textMuted, textAlign: 'center', lineHeight: 21 }}>Open a room and create a table, or join your friends when they start playing.</Text>
      <Pressable accessibilityRole="button" onPress={() => filter === 'all' ? onBrowseRooms() : setFilter('all')} style={{ minHeight: 44, justifyContent: 'center' }}><Text style={{ color: c.accent, fontFamily: fonts.medium }}>{filter === 'all' ? 'Browse rooms' : 'View all games'}</Text></Pressable>
    </View>}
    {visible.map(table => <TableCard key={`${table.room_id}:${table.match_id}`} compact roomName={table.room_name} table={table} roomId={table.room_id} busy={busy} enter={action => enter(table, action)} />)}
  </View>;
}
