import { isActiveTable } from '../multiplayer/tableNavigation';
import { ui, uiLabel } from '../i18n/copy.ts';
import { useUiLanguage } from '../i18n/useUiLanguage';
import { gameTabFinish, fonts, useTheme } from '../theme';
import { useEffect, useRef, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { AppState, Pressable, ScrollView, Text, View } from 'react-native';
import { request } from '../multiplayer/api';
import type { Session } from '../multiplayer/session';
import type { TableEntry } from '../multiplayer/tableNavigation';
import { PlayTableCard } from './PlayTableCard';
import {playFeed,type PlayTable,type PlayInvitation} from '../multiplayer/playFeed';
import {playerError} from '../multiplayer/playerError';

export type ActiveTable = PlayTable;
const filters = [['all', 'All'], ['flush', 'Flush'], ['marriage', 'Marriage'], ['callbreak', 'Call Break']] as const;
export function ActiveGames({ session, busy, enter, onBrowseRooms, onCreateTable, activity }: { activity?: { observeActivity: (listener: () => void) => () => void }; onCreateTable: () => void; onBrowseRooms: () => void; session: Session; busy: boolean; enter: (table: ActiveTable, action: TableEntry) => void }) {
  useUiLanguage();
  const { colors: c } = useTheme();
  const [actionError,setActionError]=useState(''),[discarding,setDiscarding]=useState(false);
  const requestVersion=useRef(0);
  const [tables, setTables] = useState<ActiveTable[]>([]);
  const [filter, setFilter] = useState<(typeof filters)[number][0]>("all");
  const [loaded, setLoaded] = useState(false), [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(false), [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let pending = false, dirty = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let cancelDelay: (() => void) | undefined;
    async function load() {
      if (controller.signal.aborted || AppState.currentState === 'background') return;
      if (pending) { dirty = true; return; }
      pending = true; setRefreshing(true);
      try {
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            const version=requestVersion.current;
            const [active,invitations] = await Promise.all([request<ActiveTable[]>('/active-tables', session, undefined, controller.signal),request<PlayInvitation[]>('/test-games/invitations',session,undefined,controller.signal)]);
            const data=playFeed(active.filter(isActiveTable),invitations);
            if (!controller.signal.aborted && version===requestVersion.current) { setTables(data); setLoaded(true); setError(false); }
            return;
          } catch {
            if (controller.signal.aborted) return;
            if (attempt === 2) { setError(true); return; }
            await new Promise<void>(resolve => { cancelDelay = resolve; retryTimer = setTimeout(resolve, attempt ? 2500 : 1500); });
            if (controller.signal.aborted) return;
          }
        }
      } finally {
        pending = false;
        if (!controller.signal.aborted) { setRefreshing(false); if (dirty) { dirty = false; void load(); } }
      }
    }
    void load();
    const unsubscribe = activity?.observeActivity(() => void load());
    const timer = setInterval(() => void load(), 15000);
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') void load(); });
    return () => { controller.abort(); unsubscribe?.(); clearInterval(timer); clearTimeout(retryTimer); cancelDelay?.(); subscription.remove(); };
  }, [session.token, refresh, activity]);
  const visible = tables.filter(table => filter === 'all' || table.game_type === filter);
  async function discard(table:ActiveTable){
    if(discarding||busy)return;
    setDiscarding(true);setActionError('');
    try{
      if(table.invitation_id)await request(`/test-games/invitations/${encodeURIComponent(table.invitation_id)}/decline`,session,{});
      else await request('/active-tables/discard',session,{room_id:table.room_id,table_id:table.table_id,match_id:table.match_id});
      requestVersion.current++;
      setTables(current=>current.filter(item=>item.room_id!==table.room_id||item.match_id!==table.match_id));
      setRefresh(value=>value+1);
    }catch(error){setActionError(playerError(error,ui('feedback.could_not_update_the_table_invitation')));}
    finally{setDiscarding(false);}
  }
  const retry = <Pressable accessibilityRole="button" accessibilityLabel={ui("rooms.retry_active_games")} onPress={() => setRefresh(v => v + 1)} style={{ minHeight: 44, paddingHorizontal: 16, borderRadius: 10, backgroundColor: c.primary, justifyContent: 'center' }}><Text style={{ color: c.onPrimary, fontFamily: fonts.medium }}>{ui("common.retry")}</Text></Pressable>;
  return <View testID="active-games" style={{ gap: 14, paddingVertical: 16 }}>
    <Pressable testID="play-create-table" accessibilityRole="button" accessibilityLabel={ui('rooms.create_game_table')} disabled={busy||discarding} accessibilityState={{disabled:busy||discarding}} onPress={onCreateTable}
      style={({pressed})=>({minHeight:64,paddingHorizontal:18,borderRadius:18,borderWidth:2,borderColor:c.onPrimary,backgroundColor:c.primary,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:10,opacity:busy||discarding?0.5:pressed?0.8:1})}>
      <Ionicons name="add-circle-outline" size={26} color={c.onPrimary}/><Text style={{flexShrink:1,color:c.onPrimary,fontFamily:fonts.medium,fontSize:17}}>{ui('rooms.create_game_table')}</Text>
    </Pressable>
    {!!actionError&&<Text accessibilityRole="alert" style={{color:c.danger}}>{actionError}</Text>}
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <Text accessibilityRole="header" style={{ flex: 1, color: c.text, fontFamily: fonts.medium, fontSize: 18 }}>{ui("rooms.available_tables")}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={ui("rooms.refresh_active_games")} disabled={refreshing} accessibilityState={{ disabled: refreshing }} onPress={() => setRefresh(v => v + 1)} style={{ minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center' }}><Ionicons name="refresh-outline" size={20} color={refreshing ? c.textMuted : c.accent} /></Pressable>
    </View>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }} accessibilityRole="tablist" accessibilityLabel={ui("rooms.filter_active_games")}>
      {filters.map(([value, label]) => <Pressable key={value} accessibilityRole="tab" accessibilityLabel={ui("ledger.count_games", { "count": uiLabel(label, "rooms") })} accessibilityState={{ selected: filter === value }} onPress={() => setFilter(value)} style={{ ...gameTabFinish(c, filter === value), minHeight: 44, paddingHorizontal: 14, borderRadius: 22, borderWidth: 1, borderColor: c.tableTrim, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Text style={{ color: filter === value ? c.onCoin : c.textMuted, fontFamily: fonts.medium, fontSize: 13 }}>{uiLabel(label, 'rooms')}</Text>
        {loaded && <Text style={{ color: filter === value ? c.onCoin : c.textMuted, fontSize: 12 }}>{value === 'all' ? tables.length : tables.filter(table => table.game_type === value).length}</Text>}
      </Pressable>)}
    </ScrollView>
    {error && <View accessibilityRole="alert" testID="active-games-error" style={{ gap: 12, alignItems: 'flex-start', backgroundColor: c.surface, padding: 20, borderRadius: 18, borderWidth: 1, borderColor: c.borderSubtle }}>
      <Text style={{ color: c.text, fontFamily: fonts.medium }}>{loaded ? ui("rooms.couldn_t_refresh_tables") : ui("rooms.couldn_t_load_tables")}</Text>
      <Text style={{ color: c.textMuted }}>{loaded ? ui("common.showing_the_last_available_tables_try_refreshing_again") : ui("feedback.check_your_connection_and_try_again")}</Text>{retry}
    </View>}
    {!loaded && !error && <View testID="active-games-loading" accessibilityLabel={ui("rooms.loading_active_tables")} style={{ gap: 12 }}>{[0, 1, 2].map(key => <View key={key} style={{ padding: 16, gap: 12, backgroundColor: c.surface, borderRadius: 18 }}><View style={{ width: '58%', height: 16, borderRadius: 8, backgroundColor: c.surfaceRaised }} /><View style={{ width: '80%', height: 12, borderRadius: 6, backgroundColor: c.surfaceRaised }} /><View style={{ width: '35%', height: 30, borderRadius: 15, backgroundColor: c.surfaceRaised }} /></View>)}</View>}
    {loaded && !error && !visible.length && <View testID="active-games-empty" style={{ alignItems: 'center', gap: 12, padding: 28, backgroundColor: c.surface, borderRadius: 18, borderWidth: 1, borderColor: c.borderSubtle }}>
      <Ionicons name="people-outline" size={32} color={c.accent} />
      <Text style={{ color: c.text, fontFamily: fonts.medium, fontSize: 18, textAlign: 'center' }}>{filter === 'all' ? ui("rooms.no_active_tables_yet") : ui("rooms.no_game_tables_yet", { "game": uiLabel(filters.find(([key]) => key === filter)?.[1] || '', 'rooms') })}</Text>
      <Text style={{ color: c.textMuted, textAlign: 'center', lineHeight: 21 }}>{ui("rooms.empty_games_help")}</Text>
      <Pressable accessibilityRole="button" onPress={onCreateTable} style={{minHeight:44,paddingHorizontal:16,borderRadius:10,backgroundColor:c.primary,justifyContent:'center'}}><Text style={{color:c.onPrimary,fontFamily:fonts.medium}}>{ui("rooms.create_table")}</Text></Pressable>
      <Pressable accessibilityRole="button" onPress={() => filter === 'all' ? onBrowseRooms() : setFilter('all')} style={{ minHeight: 44, justifyContent: 'center' }}><Text style={{ color: c.accent, fontFamily: fonts.medium }}>{filter === 'all' ? ui("rooms.browse_rooms") : ui("rooms.view_all_games")}</Text></Pressable>
    </View>}
    {visible.map(table => <PlayTableCard key={`${table.room_id}:${table.match_id}`} table={table} busy={busy||discarding} enter={action => enter(table, action)} discard={()=>void discard(table)}/>)}
  </View>;
}
