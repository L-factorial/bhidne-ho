import {ledgerRecordBalances, personalLedgerTransfers} from '../multiplayer/ledgerPresentation.ts';
import {AppText as Text} from './AppText';
import { retryingError, playerError } from '../multiplayer/playerError.ts';
import { gameLabel } from '../i18n/display';
import { ui, uiLabel } from '../i18n/copy.ts';
import { useUiLanguage } from '../i18n/useUiLanguage';
import { radii, gameControlFinish, gameHeadingFinish, gamePanelFinish, fonts, useTheme, useThemedStyles, type ThemeColors } from '../theme';
import { Ionicons } from '@expo/vector-icons';
import { PlayerAvatar } from './PlayerAvatar';
import { RoundResultsTable } from './RoundResultsTable';
import { useCallback, useEffect, useRef, useState } from 'react';
import {AccessibilityInfo, Animated, Pressable, StyleSheet, View} from 'react-native';
import { request } from '../multiplayer/api';
import type { Session } from '../multiplayer/session';
import { useTranslation } from 'react-i18next';

export type Balance = { player_id: string; amount: number };
export type Transfer = { transfer_id?: string; payer_id: string; payee_id: string; amount: number; status?: string; batch_id?: string; table_id?: string };
type Game = { created_at?: string; game_id: string; game_type: string; settled: boolean; balances?: Balance[]; record_balances?: Balance[] };
export type Table = { created_at?: string; table_id: string; table_name?: string; game_type?: string; latest_game_at?: string; game_count: number; balances: Balance[]; record_balances?: Balance[]; games: Game[]; suggested_transfers: Transfer[]; transactions: Transfer[] };
export type Ledger = { player_profiles?: Record<string, { display_name: string; avatar_url?: string }>; room_name?: string; players: Record<string, string>; balances: Balance[]; tables: Table[]; record_tables?: Table[]; personal_settlements: Transfer[] };
const key = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

export type LedgerTarget = {tableId?:string; gameId?:string; gameType?:string};
export type LedgerTransport = { load(): Promise<Ledger>; start(table: string, game?: string): Promise<void>; act(row: Transfer, action: 'mark-paid'|'confirm'): Promise<void>; busy: boolean; error: string };
export function RoomLedger({ roomId, session, embedded = false, transport, target }: { roomId: string; session: Session; embedded?: boolean; transport?: LedgerTransport; target?:LedgerTarget }) {
  const uiLanguage = useUiLanguage();
  const opacity=useRef(new Animated.Value(1)).current;
  useEffect(()=>{
    let active=true;
    if(!target)return;
    void AccessibilityInfo.isReduceMotionEnabled().then(reduced=>{
      if(!active || reduced)return;
      opacity.setValue(0);
      Animated.timing(opacity,{toValue:1,duration:180,useNativeDriver:true}).start();
    }).catch(()=>{});
    return()=>{active=false;opacity.stopAnimation();opacity.setValue(1);};
  },[target,opacity]);

  const styles = useThemedStyles(createStyles), [tab, setTab] = useState<'balances' | 'tables' | 'personal'>(target?'tables':'balances');
  const { t } = useTranslation();
  const { colors } = useTheme();
  const [detailTab, setDetailTab] = useState<'session' | 'games' | 'personal'>('session');
  const [selectedTable, setSelectedTable] = useState<string | undefined>(target?.tableId);
  const [expandedGames, setExpandedGames] = useState<Record<string, boolean>>({});
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<Ledger>(), [expanded, setExpanded] = useState<string|undefined>(target?.tableId);
  const [localBusy, setBusy] = useState(false), [localError, setError] = useState('');
  const busy = localBusy || !!transport?.busy, error = transport?.error || localError;
  const load = useCallback(async () => { try { const value = await (transport ? transport.load() : request<Ledger>(`/rooms/${encodeURIComponent(roomId)}/ledger`, session)); setData(value); setError(''); return value; } catch (e) { setError(retryingError(e, ui("feedback.could_not_load_ledger"))); } }, [roomId, session, uiLanguage, transport?.load]);
  useEffect(() => { setOpen(false); setExpanded(undefined); setSelectedTable(target?.tableId); setDetailTab('session'); setExpandedGames({}); setTab(target ? 'tables' : 'balances'); }, [roomId,target]);
  useEffect(() => { void load(); const timer = setInterval(() => void load(), 15_000); return () => clearInterval(timer); }, [load]);
  const targetReady=!!data && !!target && (data.record_tables || data.tables).some(table=>
    (target.tableId ? table.table_id===target.tableId : table.game_type===target.gameType) &&
    (!target.gameId || table.games.some(game=>game.game_id===target.gameId)));
  useEffect(()=>{
    if(!target || targetReady)return;
    // Finalization can publish the ledger shortly after the accepted end command.
    // Retry reads briefly; never repeat the departure or settlement command.
    let attempts=0;
    const timer=setInterval(()=>{void load();if(++attempts>=10)clearInterval(timer);},1000);
    return()=>clearInterval(timer);
  },[target,targetReady,load]);
  const focusedTable=target?.tableId || (target?.gameId
    ? (data?.record_tables || data?.tables)?.find(table=>table.games.some(game=>game.game_id===target.gameId))
    : target?.gameType ? (data?.record_tables || data?.tables)?.filter(table=>table.game_type===target.gameType)
      .sort((a,b)=>(b.latest_game_at || '').localeCompare(a.latest_game_at || ''))[0] : undefined)?.table_id;
  useEffect(()=>{if(target && focusedTable)setSelectedTable(focusedTable);},[target,focusedTable]);
  const ledgerTables=data?.record_tables || data?.tables || [];
  const orderedTables=target ? [...ledgerTables.filter(table=>table.table_id===focusedTable),...ledgerTables.filter(table=>table.table_id!==focusedTable)] : ledgerTables;
  const personalTransfers = personalLedgerTransfers(data);
  const name = (id: string) => id === session.user_id ? ui("common.you") : data?.player_profiles?.[id]?.display_name || data?.players[id] || ui("common.player_number", { "number": id.slice(0, 6) });
  async function settle(row: Transfer) {
    if (busy || row.payer_id !== session.user_id || !row.table_id) return;
    setBusy(true);
    try {
      let payment = row;
      if (!payment.batch_id || !payment.transfer_id) {
        const knownTransfers = new Set(personalTransfers.filter(value => value.batch_id && value.transfer_id).map(value => `${value.batch_id}:${value.transfer_id}`));
        if (transport) await transport.start(row.table_id);
        else await request(`/rooms/${encodeURIComponent(roomId)}/ledger/settlements`, session,
          {scope: 'table', table_id: row.table_id, idempotency_key: key()});
        const fresh = await load();
        const match = personalLedgerTransfers(fresh).find(candidate => candidate.table_id === row.table_id
          && candidate.payer_id === row.payer_id && candidate.payee_id === row.payee_id
          && candidate.amount === row.amount && candidate.status === 'OPEN' && candidate.transfer_id && candidate.batch_id
          && !knownTransfers.has(`${candidate.batch_id}:${candidate.transfer_id}`));
        if (!match) { setError(ui('ledger.balance_changed')); return; }
        payment = match;
      }
      if (transport) await transport.act(payment, 'mark-paid');
      else await request(`/rooms/${encodeURIComponent(roomId)}/ledger/settlements/${payment.batch_id}/transfers/${payment.transfer_id}/mark-paid`, session, {idempotency_key: key()});
      await load();
    } catch (e) { setError(playerError(e, ui('feedback.could_not_update_settlement'))); }
    finally { setBusy(false); }
  }
  async function accept(row: Transfer) {
    if (busy || !row.batch_id || !row.transfer_id) return;
    setBusy(true);
    try {
      if (transport) await transport.act(row, 'confirm');
      else await request(`/rooms/${encodeURIComponent(roomId)}/ledger/settlements/${row.batch_id}/transfers/${row.transfer_id}/confirm`, session, {idempotency_key:key()});
      await load();
    } catch(e) { setError(playerError(e, ui('feedback.could_not_update_settlement'))); }
    finally { setBusy(false); }
  }
  const avatar = (id: string) => data?.player_profiles?.[id]?.avatar_url;
  const balances = (rows: Balance[]) => rows.length ? <RoundResultsTable compact icon="receipt-outline" title={t('ledger.balanceSummary')} playerHeading={t('ledger.player')}
    columns={[t('ledger.net')]} rows={rows.map(row => ({ id: row.player_id, name: data?.player_profiles?.[row.player_id]?.display_name || data?.players[row.player_id] || name(row.player_id), avatarUrl: avatar(row.player_id), own: row.player_id === session.user_id,
      values: [{ text: `${row.amount > 0 ? '+' : ''}${row.amount}`, amount: row.amount }],
    }))} testID="ledger-balances" /> : <Text style={styles.muted}>{t('ledger.noResults')}</Text>;
  const person = (id: string) => <View style={styles.person}><PlayerAvatar uri={avatar(id)} /><Text numberOfLines={2} style={[styles.name, { textAlign: 'center', fontSize: 12 }]}>{name(id)}</Text></View>;
  const roomName = data?.room_name || t('ledger.roomName');
  const context = (tableId: string, tableName?: string, personal = false) => <View style={styles.context}>
    <Text style={styles.name}>{personal ? `${roomName} / ` : ''}{tableName || t('ledger.tableName')}</Text>
  </View>;
  const transfer = (row: Transfer, personal = false, table?: Table) => {
    const source = table || data?.tables.find(value => value.table_id === row.table_id);
    return <View key={row.transfer_id || `${row.payer_id}:${row.payee_id}`} style={[styles.transfer, row.status === 'RESOLVED' && styles.settled]} testID="ledger-transfer">
      <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
        {personal && row.table_id && context(row.table_id, source?.table_name, true)}
        <View style={styles.transferLabels}><Text style={styles.column}>{t('ledger.from')}</Text><Text style={styles.arrowSpace} /><Text style={styles.column}>{t('ledger.to')}</Text><Text style={styles.amountColumn}>{t('ledger.amount')}</Text></View>
        <View accessibilityLabel={ui("ledger.payer_payee_amount", { "payer": name(row.payer_id), "payee": name(row.payee_id), "amount": row.amount })} style={styles.transferRow}>
          {person(row.payer_id)}<Ionicons name="arrow-forward" size={24} color={colors.tableTrim} style={styles.arrowSpace} />{person(row.payee_id)}
          <Text style={[styles.amountColumn, styles.amount]}>{row.amount}</Text>
        </View>
        <Text style={styles.muted}>{row.status === 'RESOLVED' ? ui('ledger.settled') : row.status === 'MARKED_PAID' ? ui('ledger.awaiting_acceptance') : t(`ledger.status${row.status || 'SUGGESTED'}`)}</Text>
      </View>
      {personal && (!row.status || row.status === 'OPEN') && row.payer_id === session.user_id && <Pressable accessibilityRole="button" accessibilityState={{disabled:busy}} disabled={busy} onPress={() => void settle(row)} style={styles.action}><Text style={styles.actionText}>{ui('ledger.settle')}</Text></Pressable>}
      {personal && row.status === 'MARKED_PAID' && row.payee_id === session.user_id && <Pressable accessibilityRole="button" accessibilityState={{disabled:busy}} disabled={busy} onPress={() => void accept(row)} style={styles.action}><Text style={styles.actionText}>{ui('ledger.accept_settlement')}</Text></Pressable>}
      {personal && row.status === 'RESOLVED' && <Pressable accessibilityRole="button" disabled accessibilityState={{disabled:true}} style={[styles.action, styles.disabledAction]}><Text style={styles.actionText}>{ui('ledger.settled')}</Text></Pressable>}

    </View>;
  };
  const personalSummary = (rows: Transfer[], table?: Table) => <>
    {(['toPay', 'toReceive', 'resolved'] as const).map(section => {
      const selected = rows.filter(row => section === 'resolved' ? row.status === 'RESOLVED' && [row.payer_id, row.payee_id].includes(session.user_id)
        : row.status !== 'RESOLVED' && (section === 'toPay' ? row.payer_id : row.payee_id) === session.user_id);
      return <View key={section} style={{gap: 6}}><Text style={styles.title}>{section === 'resolved' ? ui('ledger.settled') : t(`ledger.${section}`)}</Text>
        {selected.length ? selected.map(row => transfer(row, true, table)) : <Text style={styles.muted}>{ui('ledger.no_payments')}</Text>}
      </View>;
    })}
  </>;
  const date = (value?: string) => value && Number.isFinite(Date.parse(value))
    ? new Date(value).toLocaleString(uiLanguage === 'ne' ? 'ne-NP' : 'en-US', {month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'}) : '—';
  const tableLabel = (table: Table) => `${gameLabel(table.game_type || table.games[0]?.game_type || '')} · ${table.table_name || t('ledger.tableName')}`;
  const tableHeader = (table: Table, onPress: () => void, isExpanded?: boolean) => <Pressable accessibilityRole="button"
    accessibilityState={isExpanded === undefined ? undefined : {expanded:isExpanded}} onPress={onPress} style={styles.tableHeader}>
    <View style={{flex:1,minWidth:0,gap:6}}><Text style={styles.name}>{tableLabel(table)}</Text>
      <Text style={styles.muted}>{ui('ledger.created_at', {date:date(table.created_at)})}</Text>
      <Text style={styles.muted}>{table.game_count === 1 ? ui('ledger.one_game') : ui('ledger.count_games',{count:table.game_count})}</Text></View>
    <Ionicons name={isExpanded === undefined ? 'chevron-forward' : isExpanded ? 'chevron-up' : 'chevron-down'} size={20} color={colors.textMuted}/>
  </Pressable>;
  const detail = ledgerTables.find(table => table.table_id === selectedTable);
  return <Animated.View testID="room-ledger" style={[{opacity},styles.panel, embedded && {marginTop:0,marginBottom:0,borderWidth:0,padding:0}]}>
    {!embedded && <Pressable testID="ledger-section-toggle" accessibilityRole="button" accessibilityLabel={t('ledger.section')}
      aria-expanded={open} accessibilityState={{expanded:open}} onPress={() => setOpen(value => !value)} style={styles.sectionToggle}>
      <Text style={styles.name}>{t('ledger.section')}</Text><Text style={styles.name}>{open ? '−' : '+'}</Text>
    </Pressable>}
    {(embedded || open) && <>
      {!!error && <Text activity accessibilityRole="alert" style={styles.error}>{uiLabel(error,'feedback')}</Text>}
      {tab === 'tables' && detail ? <View testID="ledger-table-detail" style={{gap:12}}>
        <Pressable accessibilityRole="button" accessibilityLabel={ui('ledger.back_to_tables')} onPress={() => setSelectedTable(undefined)} style={styles.row}>
          <Ionicons name="arrow-back" size={24} color={colors.accent}/><Text style={styles.link}>{ui('ledger.back_to_tables')}</Text>
        </Pressable>
        <Text style={styles.title}>{tableLabel(detail)}</Text><Text style={styles.muted}>{ui('ledger.created_at',{date:date(detail.created_at)})}</Text>
        <View accessibilityRole="tablist" style={styles.tabs}>{(['session','games','personal'] as const).map(value => <Pressable key={value} accessibilityRole="tab" aria-selected={detailTab === value}
          accessibilityState={{selected:detailTab === value}} onPress={() => setDetailTab(value)} style={styles.tab}>
          <Text style={[styles.tabText,detailTab === value && styles.selectedText]}>{ui(value === 'session' ? 'ledger.entire_session' : value === 'games' ? 'ledger.games_breakdown' : 'ledger.my_settlement')}</Text>
          {detailTab === value && <View style={styles.underline}/>}</Pressable>)}</View>
        {detailTab === 'personal' ? <View testID="ledger-table-settlement" style={{gap:6}}>
          <Text style={styles.muted}>{ui('ledger.game_results_and_records_only_payments_happen_outside_bhidne_ho')}</Text>
          {personalSummary(personalTransfers.filter(row => row.table_id === detail.table_id),detail)}
        </View> : detailTab === 'session' ? balances(detail.record_balances || detail.balances) : <>
          {!detail.games.length && <Text style={styles.muted}>{t('ledger.noResults')}</Text>}
          {detail.games.map((game,index) => <View key={game.game_id} style={styles.table} testID={`ledger-game-${game.game_id}`}>
            <Pressable accessibilityRole="button" accessibilityState={{expanded:!!expandedGames[game.game_id]}}
              onPress={() => setExpandedGames(previous => ({...previous,[game.game_id]:!previous[game.game_id]}))} style={styles.tableHeader}>
              <View style={{gap:6,flex:1}}><Text style={styles.name}>{ui('ledger.game_number',{number:index+1})} · {gameLabel(game.game_type)}</Text><Text style={styles.muted}>{date(game.created_at)}</Text></View>
              <Ionicons name={expandedGames[game.game_id] ? 'chevron-up':'chevron-down'} size={20} color={colors.textMuted}/>
            </Pressable>{expandedGames[game.game_id] && <View style={styles.body}>{balances(game.record_balances || game.balances || [])}</View>}
          </View>)}
        </>}
      </View> : <>
        <View accessibilityRole="tablist" style={styles.tabs}>{([['balances','ledger.balances'],['tables','ledger.table_ledgers'],['personal','ledger.my_settlement']] as const).map(([value,label]) => <Pressable key={value} accessibilityRole="tab" aria-selected={tab === value} accessibilityState={{selected:tab === value}} onPress={() => setTab(value)} style={styles.tab}>
          <Text style={[styles.tabText,tab === value && styles.selectedText]}>{ui(label)}</Text>{tab === value && <View style={styles.underline}/>}</Pressable>)}</View>
        <Text style={styles.muted}>{ui('ledger.game_results_and_records_only_payments_happen_outside_bhidne_ho')}</Text>
        {tab === 'balances' && balances(ledgerRecordBalances(data))}
        {tab === 'tables' && <>{!!data && !orderedTables.length && <Text style={styles.muted}>{t('ledger.noResults')}</Text>}
          {orderedTables.map(table => <View key={table.table_id} testID={`ledger-table-card-${table.table_id}`} style={styles.table}>
            {tableHeader(table,() => {setSelectedTable(table.table_id);setDetailTab('session');})}
          </View>)}</>}
        {tab === 'personal' && <>{!!data && !orderedTables.length && <Text style={styles.muted}>{t('ledger.noResults')}</Text>}
          {orderedTables.map(table => <View key={table.table_id} testID={`ledger-personal-table-${table.table_id}`} style={styles.table}>
            {tableHeader(table,() => setExpanded(value => value === table.table_id ? undefined : table.table_id),expanded === table.table_id)}
            {expanded === table.table_id && <View style={styles.body}>{personalSummary(personalTransfers.filter(row => row.table_id === table.table_id),table)}</View>}
          </View>)}</>}
      </>}
    </>}
  </Animated.View>;
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({ settled: {opacity:0.5}, disabledAction: {backgroundColor:colors.textMuted}, context: { gap: 3 }, code: { color: colors.textMuted, fontFamily: fonts.body, fontSize: 11, lineHeight: 16, opacity: 0.8, flexShrink: 1 }, panel: { ...gamePanelFinish(colors), marginTop: 20, marginBottom: 20, padding: 18, borderRadius: radii.large, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, gap: 10 }, sectionToggle: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }, tabs: { flexDirection: 'row', flexWrap: 'wrap', borderBottomWidth: 1, borderColor: colors.borderSubtle }, tab: { flexGrow: 1, flexBasis: 90, minWidth: 0, minHeight: 56, paddingHorizontal: 5, paddingVertical: 10, alignItems: 'center', justifyContent: 'center' }, tabText: { textAlign: 'center', fontSize: 14, fontFamily: fonts.medium, color: colors.textMuted }, selectedText: { color: colors.accent }, underline: { position: 'absolute', bottom: 0, width: '70%', height: 3, borderRadius: 3, backgroundColor: colors.accent }, title: { ...gameHeadingFinish(colors), color: colors.text, fontFamily: fonts.display, fontSize: 20, marginTop: 6 }, subtitle: { color: colors.text, fontFamily: fonts.medium, marginTop: 8 }, row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5 }, name: { color: colors.text, fontFamily: fonts.medium }, amount: { fontFamily: fonts.medium, fontSize: 16, color: colors.text, fontVariant: ['tabular-nums'] }, positive: { color: colors.success }, negative: { color: colors.danger }, muted: { color: colors.textMuted, fontFamily: fonts.body, fontSize: 12 }, table: { borderWidth: 1, borderColor: colors.borderSubtle, borderRadius: radii.large, overflow: 'hidden' }, tableHeader: { flexDirection: 'row', justifyContent: 'space-between', padding: 12 }, body: { padding: 12, borderTopWidth: 1, borderColor: colors.border, gap: 6 }, transfer: { ...gamePanelFinish(colors), gap: 12, padding: 12, borderRadius: radii.large, borderWidth: 1, borderColor: colors.borderSubtle, backgroundColor: colors.surface, marginVertical: 4 }, transferRow: { flexDirection: 'row', alignItems: 'center' }, transferLabels: { flexDirection: 'row', alignItems: 'center', paddingBottom: 6, borderBottomWidth: 1, borderColor: colors.borderSubtle }, person: { flex: 1, minWidth: 0, alignItems: 'center', gap: 6 }, column: { flex: 1, color: colors.textMuted, fontFamily: fonts.medium, fontSize: 11, textAlign: 'center' }, arrowSpace: { width: 28, textAlign: 'center' }, amountColumn: { width: 64, color: colors.textMuted, fontFamily: fonts.medium, fontSize: 11, textAlign: 'right' }, action: { ...gameControlFinish(colors), alignSelf: 'flex-start', padding: 9, borderRadius: radii.medium, backgroundColor: colors.primary }, actionText: { color: colors.onPrimary, fontFamily: fonts.medium, fontSize: 12 }, link: { color: colors.accent, fontFamily: fonts.medium, fontSize: 12 }, error: { color: colors.danger, fontFamily: fonts.body } });
