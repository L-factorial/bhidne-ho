import {isActivityCopy} from '../multiplayer/activityCopy';
import {ActivityLine} from './ActivityLine';
import {AppText as Text} from './AppText';
import { isVisiblePlayTable } from '../multiplayer/tableNavigation';
import { ui, uiLabel } from '../i18n/copy.ts';
import { useUiLanguage } from '../i18n/useUiLanguage';
import { visualStates, radii, gameTabFinish, typography, fonts, useTheme } from '../theme';
import { useEffect, useRef, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import {AppState, Pressable, View} from 'react-native';
import { request } from '../multiplayer/api';
import type { Session } from '../multiplayer/session';
import type { TableEntry } from '../multiplayer/tableNavigation';
import {CreationCards} from './CreationCards';
import type {OriginalDistributedRuntime} from '../multiplayer/OriginalDistributedRuntime';
import { PlayTableCard } from './PlayTableCard';
import {playFeed,type PlayTable,type PlayInvitation} from '../multiplayer/playFeed';
import {retryingError,playerError} from '../multiplayer/playerError';
import {EmptyTablesArtwork,NoMatchingTablesArtwork} from './GameArtwork';

export type ActiveTable = PlayTable;
const filters = [['all', 'All'], ['flush', 'Flush'], ['marriage', 'Marriage'], ['callbreak', 'Call Break']] as const;
export function ActiveGames({ session, busy, enter, onBrowseRooms, onCreateTable, activity, runtime }: { runtime?:OriginalDistributedRuntime|null; activity?: { observeActivity: (listener: () => void) => () => void }; onCreateTable: () => void; onBrowseRooms: () => void; session: Session; busy: boolean; enter: (table: ActiveTable, action: TableEntry) => void }) {
  useUiLanguage();
  const { colors: c } = useTheme();
  const [actionError,setActionError]=useState(''),[discarding,setDiscarding]=useState(false);
  const requestVersion=useRef(0);
  const [tables, setTables] = useState<ActiveTable[]>([]);
  const [filter, setFilter] = useState<(typeof filters)[number][0]>("all");
  const [loaded, setLoaded] = useState(false), [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(''), [refresh, setRefresh] = useState(0);
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
            const data=playFeed(active.filter(isVisiblePlayTable),invitations);
            if (!controller.signal.aborted && version===requestVersion.current) { setTables(data); setLoaded(true); setError(''); }
            return;
          } catch (failure) {
            if (controller.signal.aborted) return;
            if (attempt === 2) { setError(retryingError(failure)); return; }
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
  const hasTables = tables.length > 0;
  const selectedGame = uiLabel(filters.find(([key]) => key === filter)?.[1] || '', 'rooms');
  useEffect(() => { if (loaded && !hasTables) setFilter('all'); }, [loaded, hasTables]);
  async function leaveTable(table:ActiveTable){
    if(discarding||busy||!table.current_user?.can_leave_seat)return;
    setDiscarding(true);setActionError('');
    try{
      await request(`/test-games/${encodeURIComponent(table.room_id)}/leave`,session,{match_id:table.match_id});
      runtime?.clearSeatConflict(table.room_id,table.match_id);
      requestVersion.current++;
      setTables(current=>current.filter(item=>item.room_id!==table.room_id||item.match_id!==table.match_id));
      setRefresh(value=>value+1);
    }catch(error){setActionError(playerError(error));}
    finally{setDiscarding(false);}
  }
  async function declineInvitation(table:ActiveTable){
    if(discarding||busy||!table.invitation_id||table.current_user?.is_seated)return;
    setDiscarding(true);setActionError('');
    try{
      await request(`/test-games/invitations/${encodeURIComponent(table.invitation_id)}/decline`,session,{});
      requestVersion.current++;
      setTables(current=>current.filter(item=>item.room_id!==table.room_id||item.match_id!==table.match_id));
      setRefresh(value=>value+1);
    }catch(error){setActionError(playerError(error,ui('feedback.could_not_update_the_table_invitation')));}
    finally{setDiscarding(false);}
  }
  const retry = <Pressable accessibilityRole="button" accessibilityLabel={ui("rooms.retry_active_games")} onPress={() => setRefresh(v => v + 1)} style={{ minHeight: 44, paddingHorizontal: 16, borderRadius: radii.medium, backgroundColor: c.primary, justifyContent: 'center' }}><Text style={{ color: c.onPrimary, fontFamily: fonts.medium }}>{ui("common.retry")}</Text></Pressable>;
  const createButton = (top = false) => (
    <Pressable testID={top?"play-create-table":"empty-play-create-table"} accessibilityRole="button" accessibilityLabel={ui('rooms.create_game_table_top')} disabled={busy||discarding} accessibilityState={{disabled:busy||discarding}} onPress={onCreateTable}
      style={({pressed})=>({minHeight:64,paddingHorizontal:18,borderRadius: radii.large,borderWidth:2,borderColor:c.onPrimary,backgroundColor:c.primary,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:10,opacity:busy||discarding?visualStates.disabledOpacity:pressed?0.8:1})}>
      <Ionicons name="add" size={26} color={c.onPrimary}/><Text style={{flexShrink:1,color:c.onPrimary,fontFamily:fonts.medium,fontSize:17}}>{ui('rooms.create_game_table_top')}</Text>
    </Pressable>
  );
  return <View testID="active-games" style={{ gap: 14, paddingVertical: 16 }}>
    {hasTables && createButton(true)}
    {!!actionError&&<Text accessibilityRole="alert" style={{color:c.danger}}>{actionError}</Text>}
    {hasTables && <><View testID="active-games-heading" style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <Text accessibilityRole="header" style={{ flex: 1, color: c.text, fontFamily: fonts.editorial, fontSize: typography.pageTitle }}>{ui("rooms.available_tables")}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={ui("rooms.refresh_active_games")} disabled={refreshing} accessibilityState={{ disabled: refreshing }} onPress={() => setRefresh(v => v + 1)} style={{ minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center' }}><Ionicons name="refresh-outline" size={20} color={refreshing ? c.textMuted : c.accent} /></Pressable>
    </View>
    <View testID="active-game-filters" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }} accessibilityRole="tablist" accessibilityLabel={ui("rooms.filter_active_games")}>
      {filters.map(([value, label]) => <Pressable key={value} accessibilityRole="tab" accessibilityLabel={ui("ledger.count_games", { "count": uiLabel(label, "rooms") })} accessibilityState={{ selected: filter === value }} aria-selected={filter === value} onPress={() => setFilter(value)} style={{ ...gameTabFinish(c, filter === value), minHeight: 44, paddingHorizontal: 14, paddingVertical: 8, maxWidth: '100%', borderRadius: radii.large, borderWidth: 1, borderColor: c.tableTrim, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Text style={{ color: filter === value ? c.onCoin : c.textMuted, fontFamily: fonts.medium, fontSize: 13, flexShrink: 1 }}>{uiLabel(label, 'rooms')}</Text>
        {loaded && <Text style={{ color: filter === value ? c.onCoin : c.textMuted, fontSize: 12 }}>{value === 'all' ? tables.length : tables.filter(table => table.game_type === value).length}</Text>}
      </Pressable>)}
    </View></>}
    {!!error && isActivityCopy(error) && <ActivityLine />}
    {!!error && !isActivityCopy(error) && <View accessibilityRole="alert" testID="active-games-error" style={{ gap: 12, alignItems: 'flex-start', backgroundColor: c.surface, padding: 20, borderRadius: radii.large, borderWidth: 1, borderColor: c.borderSubtle }}>
      <Text style={{ color: c.text, fontFamily: fonts.medium }}>{loaded ? ui("rooms.couldn_t_refresh_tables") : ui("rooms.couldn_t_load_tables")}</Text>
      <Text style={{ color: c.textMuted }}>{loaded ? ui("common.showing_the_last_available_tables_try_refreshing_again") : ui("feedback.check_your_connection_and_try_again")}</Text>{retry}
    </View>}
    {!loaded && !error && <View testID="active-games-loading" style={{minHeight:120,justifyContent:'center',padding:16}}><ActivityLine /></View>}
    {loaded && !error && !visible.length && <View testID="active-games-empty" style={{ alignItems: 'center', justifyContent:'center', gap: 16, padding: 24, paddingVertical:hasTables?28:32, backgroundColor: c.surface, borderRadius: radii.large, borderWidth: 1, borderColor: c.border, minHeight:hasTables?244:320 }}>
      {hasTables ? <NoMatchingTablesArtwork color={c.accent}/> : <EmptyTablesArtwork/>}
      <Text accessibilityRole="header" style={{ color: c.text, fontFamily: fonts.editorial, fontSize: typography.pageTitle, textAlign: 'center' }}>{hasTables ? ui('rooms.no_game_tables_right_now', {game:selectedGame}) : ui('rooms.empty_tables_title')}</Text>
      <Text style={{ color: c.textMuted, textAlign: 'center', lineHeight: 23, maxWidth:360 }}>{hasTables ? ui('rooms.empty_filtered_games_help', {game:selectedGame}) : ui('rooms.empty_tables_welcome')}</Text>
      <View style={{alignSelf:'stretch',gap:12}}>
      {!hasTables && createButton()}
      <Pressable accessibilityRole="button" accessibilityLabel={ui(hasTables?'rooms.view_all_games':'rooms.browse_rooms')} onPress={() => hasTables ? setFilter('all') : onBrowseRooms()} style={({pressed})=>({ minHeight: hasTables?48:64, paddingHorizontal:18, borderRadius:hasTables?radii.medium:radii.large, borderWidth:1, borderColor:c.accent, flexDirection:'row', alignItems:'center', justifyContent: 'center', gap:10, backgroundColor:pressed?c.surfaceSelected:'transparent' })}>
        <Text style={{ color: c.accent, fontFamily: fonts.medium, fontSize:hasTables?14:17, textAlign:'center', flexShrink:1 }}>{ui(hasTables?'rooms.view_all_games':'rooms.browse_rooms')}</Text>
        {!hasTables&&<Ionicons name="arrow-forward" size={20} color={c.accent} accessible={false}/>}
      </Pressable>
      </View>
    </View>}
    <CreationCards runtime={runtime} onReleased={()=>setRefresh(value=>value+1)} onReturn={table=>enter(table,'watch')} kind="table" matches={tables.map(table=>table.match_id)}/>
    {visible.map(table => <PlayTableCard key={`${table.room_id}:${table.match_id}`} table={table} busy={busy||discarding} enter={action => enter(table, action)} declineInvitation={()=>void declineInvitation(table)} leave={()=>void leaveTable(table)}/>)}
  </View>;
}
