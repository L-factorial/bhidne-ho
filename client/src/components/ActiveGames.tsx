import { useEffect, useState } from 'react';
import { AppState, Pressable, Text, View } from 'react-native';
import { request } from '../multiplayer/api';
import type { Session } from '../multiplayer/session';
import type { TableEntry, TableSummary } from '../multiplayer/tableNavigation';
import { fonts, useTheme } from '../theme';
import { TableCard } from './TableCard';

export type ActiveTable = TableSummary & { room_id: string; room_name: string };
export function ActiveGames({ session, busy, enter }: { session: Session; busy: boolean; enter: (table: ActiveTable, action: TableEntry) => void }) {
  const { colors: c } = useTheme();
  const [tables, setTables] = useState<ActiveTable[]>([]);
  const [loading, setLoading] = useState(true), [error, setError] = useState(''), [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let pending = false;
    async function load() {
      if (pending || controller.signal.aborted || AppState.currentState === 'background') return;
      pending = true;
      try {
        const data = await request<ActiveTable[]>('/active-tables', session, undefined, controller.signal);
        if (!controller.signal.aborted) { setTables(data.filter(t => t.status !== 'ended' && t.phase !== 'ENDED')); setError(''); }
      } catch (e) { if (!controller.signal.aborted) setError((e as Error).message); }
      finally { pending = false; if (!controller.signal.aborted) setLoading(false); }
    }
    void load();
    const timer = setInterval(() => void load(), 15000);
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') void load(); });
    return () => { controller.abort(); clearInterval(timer); subscription.remove(); };
  }, [session.token, refresh]);
  return <View testID="active-games" style={{ gap: 16, paddingVertical: 12 }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <Text style={{ flex: 1, color: c.textMuted, fontFamily: fonts.body }}>Take a seat, watch, or join a waiting queue.</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Refresh active games" onPress={() => setRefresh(v => v + 1)} style={{ minHeight: 44, paddingHorizontal: 8, justifyContent: 'center' }}><Text style={{ color: c.accent }}>Refresh</Text></Pressable>
    </View>
    {loading && <Text style={{ color: c.textMuted }}>Loading active tables…</Text>}
    {!!error && <Text accessibilityRole="alert" style={{ color: c.danger }}>{error}</Text>}
    {(['flush', 'marriage', 'callbreak'] as const).map(kind => {
      const group = tables.filter(table => table.game_type === kind);
      return <View key={kind} testID={`active-games-${kind}`} style={{ gap: 8 }}>
        <Text accessibilityRole="header" style={{ color: c.text, fontFamily: fonts.medium, fontSize: 22 }}>{({ flush: 'Flush', marriage: 'Marriage', callbreak: 'Call Break' })[kind]} · {group.length}</Text>
        {!loading && !error && !group.length && <Text style={{ color: c.textMuted, paddingVertical: 12 }}>No active tables yet.</Text>}
        {group.map(table => <View key={`${table.room_id}:${table.match_id}`}><Text style={{ color: c.textMuted, fontFamily: fonts.body, marginBottom: 6 }}>{table.room_name}</Text><TableCard table={table} roomId={table.room_id} busy={busy} enter={action => enter(table, action)} /></View>)}
      </View>;
    })}
  </View>;
}
