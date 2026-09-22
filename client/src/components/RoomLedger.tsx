import { Ionicons } from '@expo/vector-icons';
import { PlayerAvatar } from './PlayerAvatar';
import { RoundResultsTable } from './RoundResultsTable';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { request } from '../multiplayer/api';
import type { Session } from '../multiplayer/session';
import { fonts, useTheme, useThemedStyles, type ThemeColors } from '../theme';
import { useTranslation } from 'react-i18next';

type Balance = { player_id: string; amount: number };
type Transfer = { transfer_id?: string; payer_id: string; payee_id: string; amount: number; status?: string; batch_id?: string; table_id?: string };
type Game = { game_id: string; game_type: string; settled: boolean; balances?: Balance[] };
type Table = { table_id: string; table_name?: string; game_count: number; balances: Balance[]; games: Game[]; suggested_transfers: Transfer[]; transactions: Transfer[] };
type Ledger = { player_profiles?: Record<string, { display_name: string; avatar_url?: string }>; room_name?: string; players: Record<string, string>; balances: Balance[]; tables: Table[]; personal_settlements: Transfer[] };
const key = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

export function RoomLedger({ roomId, session, embedded = false }: { roomId: string; session: Session; embedded?: boolean }) {
  const styles = useThemedStyles(createStyles), [tab, setTab] = useState<'ledger' | 'personal'>('ledger');
  const { t } = useTranslation();
  const { colors } = useTheme();
  const [showCodes, setShowCodes] = useState(false);
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<Ledger>(), [expanded, setExpanded] = useState<string>();
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const load = useCallback(async () => { try { setData(await request<Ledger>(`/rooms/${encodeURIComponent(roomId)}/ledger`, session)); setError(''); } catch (e) { setError(e instanceof Error ? e.message : 'Could not load ledger.'); } }, [roomId, session]);
  useEffect(() => { setOpen(false); setExpanded(undefined); }, [roomId]);
  useEffect(() => { void load(); const timer = setInterval(() => void load(), 15_000); return () => clearInterval(timer); }, [load]);
  const name = (id: string) => id === session.user_id ? 'You' : data?.player_profiles?.[id]?.display_name || data?.players[id] || `Player ${id.slice(0, 6)}`;
  async function start(tableId: string, gameId?: string) { setBusy(true); try { await request(`/rooms/${encodeURIComponent(roomId)}/ledger/settlements`, session, { scope: gameId ? 'game' : 'table', table_id: tableId, ...(gameId && { game_id: gameId }), idempotency_key: key() }); await load(); } catch (e) { setError(e instanceof Error ? e.message : 'Could not start settlement.'); } finally { setBusy(false); } }
  async function act(row: Transfer, action: 'mark-paid' | 'confirm') { if (!row.batch_id || !row.transfer_id) return; setBusy(true); try { await request(`/rooms/${encodeURIComponent(roomId)}/ledger/settlements/${row.batch_id}/transfers/${row.transfer_id}/${action}`, session, { idempotency_key: key() }); await load(); } catch (e) { setError(e instanceof Error ? e.message : 'Could not update settlement.'); } finally { setBusy(false); } }
  const avatar = (id: string) => data?.player_profiles?.[id]?.avatar_url;
  const balances = (rows: Balance[]) => rows.length ? <RoundResultsTable compact icon="receipt-outline" title={t('ledger.balanceSummary')} playerHeading={t('ledger.player')}
    columns={[t('ledger.net')]} rows={rows.map(row => ({ id: row.player_id, name: data?.player_profiles?.[row.player_id]?.display_name || data?.players[row.player_id] || name(row.player_id), avatarUrl: avatar(row.player_id), own: row.player_id === session.user_id,
      values: [{ text: `${row.amount > 0 ? '+' : ''}${row.amount}`, amount: row.amount }],
    }))} testID="ledger-balances" /> : <Text style={styles.muted}>{t('ledger.noResults')}</Text>;
  const person = (id: string) => <View style={styles.person}><PlayerAvatar uri={avatar(id)} /><Text numberOfLines={2} style={[styles.name, { textAlign: 'center', fontSize: 12 }]}>{name(id)}</Text></View>;
  const roomName = data?.room_name || t('ledger.roomName');
  const context = (tableId: string, tableName?: string, personal = false) => <View style={styles.context}>
    <Text style={styles.name}>{personal ? `${roomName} / ` : ''}{tableName || t('ledger.tableName')}</Text>
    {showCodes && personal && <Text selectable style={styles.code}>{t('ledger.roomCode', { code: roomId })}</Text>}
    {showCodes && <Text selectable style={styles.code}>{t('ledger.tableCode', { code: tableId })}</Text>}
  </View>;
  const transfer = (row: Transfer, personal = false, table?: Table) => {
    const source = table || data?.tables.find(value => value.table_id === row.table_id);
    return <View key={row.transfer_id || `${row.payer_id}:${row.payee_id}`} style={styles.transfer} testID="ledger-transfer">
      <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
        {personal && row.table_id && context(row.table_id, source?.table_name, true)}
        <View style={styles.transferLabels}><Text style={styles.column}>{t('ledger.from')}</Text><Text style={styles.arrowSpace} /><Text style={styles.column}>{t('ledger.to')}</Text><Text style={styles.amountColumn}>{t('ledger.amount')}</Text></View>
        <View accessibilityLabel={`${name(row.payer_id)} → ${name(row.payee_id)} · ${row.amount}`} style={styles.transferRow}>
          {person(row.payer_id)}<Ionicons name="arrow-forward" size={24} color={colors.tableTrim} style={styles.arrowSpace} />{person(row.payee_id)}
          <Text style={[styles.amountColumn, styles.amount]}>{row.amount}</Text>
        </View>
        <Text style={styles.muted}>{t(`ledger.status${row.status || 'SUGGESTED'}`)}</Text>
      </View>
      {personal && row.status === 'OPEN' && row.payer_id === session.user_id && <Pressable accessibilityRole="button" accessibilityState={{ disabled: busy }} disabled={busy} onPress={() => void act(row, 'mark-paid')} style={styles.action}><Text style={styles.actionText}>{t('ledger.markPaid')}</Text></Pressable>}
      {personal && row.status === 'MARKED_PAID' && row.payee_id === session.user_id && <Pressable accessibilityRole="button" accessibilityState={{ disabled: busy }} disabled={busy} onPress={() => void act(row, 'confirm')} style={styles.action}><Text style={styles.actionText}>{t('ledger.confirmReceived')}</Text></Pressable>}
    </View>;
  };
  return <View style={[styles.panel, embedded && { marginTop: 0, marginBottom: 0, borderWidth: 0, padding: 0 }]}>
    {!embedded && <Pressable testID="ledger-section-toggle" accessibilityRole="button" accessibilityLabel={t('ledger.section')}
      aria-expanded={open} accessibilityState={{ expanded: open }} onPress={() => setOpen(value => !value)} style={styles.sectionToggle}>
      <Text style={styles.name}>{t('ledger.section')}</Text><Text style={styles.name}>{open ? '−' : '+'}</Text>
    </Pressable>}
    {(embedded || open) && <><View style={styles.tabs}>{([['ledger', 'ledger.ledger'], ['personal', 'ledger.personal']] as const).map(([value, label]) => <Pressable key={value} accessibilityRole="tab" accessibilityState={{ selected: tab === value }} onPress={() => setTab(value)} style={[styles.tab, tab === value && styles.selected]}><Text style={styles.name}>{t(label)}</Text></Pressable>)}</View>{!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
    <Text style={styles.muted}>Game results and records only. Payments happen outside Bhidne Ho.</Text>
    <Pressable accessibilityRole="button" accessibilityState={{ expanded: showCodes }} onPress={() => setShowCodes(value => !value)} style={{ minHeight: 44, justifyContent: 'center' }}><Text style={styles.link}>{showCodes ? 'Hide room/table codes' : 'Show room/table codes'}</Text></Pressable>
    {showCodes && <Text selectable style={styles.code}>{t('ledger.roomCode', { code: roomId })}</Text>}
    {tab === 'ledger' ? <>{balances(data?.balances || [])}{(data?.tables || []).map(table => <View key={table.table_id} style={styles.table}><Pressable accessibilityRole="button" accessibilityState={{ expanded: expanded === table.table_id }} onPress={() => setExpanded(value => value === table.table_id ? undefined : table.table_id)} style={styles.tableHeader}><View style={{ flex: 1, minWidth: 0, gap: 4 }}>{context(table.table_id, table.table_name)}<Text style={styles.muted}>{t('ledger.gameCount', { count: table.game_count })}</Text></View><Text style={styles.name}>{expanded === table.table_id ? '−' : '+'}</Text></Pressable>{expanded === table.table_id && <View style={styles.body}>{balances(table.balances)}<Text style={styles.subtitle}>{t('ledger.summary')}</Text>{table.transactions.map(row => transfer(row, false, table))}{table.suggested_transfers.map(row => transfer(row, false, table))}{!!table.suggested_transfers.length && <Pressable accessibilityRole="button" accessibilityState={{ disabled: busy }} disabled={busy} onPress={() => void start(table.table_id)} style={styles.action}><Text style={styles.actionText}>{t('ledger.startTable')}</Text></Pressable>}<Text style={styles.subtitle}>{t('ledger.games')}</Text>{table.games.map((game, index) => <View key={game.game_id} style={{ gap: 8, paddingVertical: 8 }}><View style={styles.row}><Text style={styles.muted}>Game {index + 1} · {game.game_type} · {t(game.settled ? 'ledger.inSettlement' : 'ledger.open')}</Text>{!game.settled && <Pressable accessibilityRole="button" accessibilityState={{ disabled: busy }} disabled={busy} onPress={() => void start(table.table_id, game.game_id)}><Text style={styles.link}>{t('ledger.settleGame')}</Text></Pressable>}</View>{game.balances && balances(game.balances)}</View>)}</View>}</View>)}</> : <><Text style={styles.title}>{t('ledger.toPay')}</Text>{(data?.personal_settlements || []).filter(x => x.payer_id === session.user_id && x.status !== 'RESOLVED').map(x => transfer(x, true))}<Text style={styles.title}>{t('ledger.toReceive')}</Text>{(data?.personal_settlements || []).filter(x => x.payee_id === session.user_id && x.status !== 'RESOLVED').map(x => transfer(x, true))}<Text style={styles.title}>{t('ledger.resolved')}</Text>{(data?.personal_settlements || []).filter(x => x.status === 'RESOLVED').map(x => transfer(x, true))}</>}
    </>}
  </View>;
}
const createStyles = (colors: ThemeColors) => StyleSheet.create({ context: { gap: 3 }, code: { color: colors.textMuted, fontFamily: fonts.body, fontSize: 11, lineHeight: 16, opacity: 0.8, flexShrink: 1 }, panel: { marginTop: 20, marginBottom: 20, padding: 18, borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, gap: 10 }, sectionToggle: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }, tabs: { flexDirection: 'row', gap: 8 }, tab: { padding: 10, borderRadius: 8, borderWidth: 1, borderColor: colors.border }, selected: { backgroundColor: colors.surfaceSelected }, title: { color: colors.text, fontFamily: fonts.display, fontSize: 20, marginTop: 6 }, subtitle: { color: colors.text, fontFamily: fonts.medium, marginTop: 8 }, row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5 }, name: { color: colors.text, fontFamily: fonts.medium }, amount: { fontFamily: fonts.medium, fontSize: 16, color: colors.text, fontVariant: ['tabular-nums'] }, positive: { color: colors.success }, negative: { color: colors.danger }, muted: { color: colors.textMuted, fontFamily: fonts.body, fontSize: 12 }, table: { borderWidth: 1, borderColor: colors.borderSubtle, borderRadius: 20, overflow: 'hidden' }, tableHeader: { flexDirection: 'row', justifyContent: 'space-between', padding: 12 }, body: { padding: 12, borderTopWidth: 1, borderColor: colors.border, gap: 6 }, transfer: { gap: 12, padding: 12, borderRadius: 16, borderWidth: 1, borderColor: colors.borderSubtle, backgroundColor: colors.surface, marginVertical: 4 }, transferRow: { flexDirection: 'row', alignItems: 'center' }, transferLabels: { flexDirection: 'row', alignItems: 'center', paddingBottom: 6, borderBottomWidth: 1, borderColor: colors.borderSubtle }, person: { flex: 1, minWidth: 0, alignItems: 'center', gap: 6 }, column: { flex: 1, color: colors.textMuted, fontFamily: fonts.medium, fontSize: 11, textAlign: 'center' }, arrowSpace: { width: 28, textAlign: 'center' }, amountColumn: { width: 64, color: colors.textMuted, fontFamily: fonts.medium, fontSize: 11, textAlign: 'right' }, action: { alignSelf: 'flex-start', padding: 9, borderRadius: 8, backgroundColor: colors.primary }, actionText: { color: colors.onPrimary, fontFamily: fonts.medium, fontSize: 12 }, link: { color: colors.accent, fontFamily: fonts.medium, fontSize: 12 }, error: { color: colors.danger, fontFamily: fonts.body } });
