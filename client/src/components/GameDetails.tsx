import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import type { RoomSnapshot } from '../screens/LiveGameTable';
import { fonts, useThemedStyles, type ThemeColors } from '../theme';

export function GameDetails({ snapshot, busy, onSave, sidebar = false }: {
  sidebar?: boolean; snapshot: RoomSnapshot; busy: boolean; onSave: (settings: NonNullable<RoomSnapshot['settings']>) => void;
}) {
  const styles = useThemedStyles(createStyles);
  const [tab, setTab] = useState<'stats' | 'rules' | null>(null);
  const selectedTab = tab ?? (sidebar ? 'stats' : null);
  const [draft, setDraft] = useState(snapshot.settings);
  const editable = snapshot.is_creator && snapshot.status === 'waiting';
  const settings = editable ? draft || snapshot.settings : snapshot.settings;
  return <View testID={sidebar ? "game-details-sidebar" : "game-details-inline"} style={[styles.panel, sidebar && styles.sidebar]}>
    <View style={styles.row} accessibilityRole={sidebar ? 'tablist' : undefined}>{(['stats', 'rules'] as const).map(value => <Pressable key={value} accessibilityRole={sidebar ? 'tab' : 'button'}
      accessibilityLabel={value === 'stats' ? 'Stats' : 'Rules'} aria-selected={sidebar ? selectedTab === value : undefined}
      accessibilityState={sidebar ? { selected: selectedTab === value } : { expanded: selectedTab === value }} onPress={() => { setDraft(snapshot.settings); setTab(!sidebar && tab === value ? null : value); }} style={[styles.button, sidebar && selectedTab === value && styles.selectedTab]}>
      <Text style={styles.label}>{value === 'stats' ? 'Stats' : 'Rules'}{sidebar ? '' : selectedTab === value ? ' -' : ' +'}</Text>
    </Pressable>)}</View>
    {selectedTab && <ScrollView style={sidebar ? styles.sidebarDetails : styles.details} nestedScrollEnabled contentContainerStyle={{ gap: 12, paddingVertical: 12 }}>
      {selectedTab === 'stats' ? <>
        <View style={styles.statsTable}>
          <View style={styles.statsRow}>
            <Text style={styles.cell}>Deal</Text>
            {(snapshot.players || []).map(player => <Text key={player.player_id} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75} accessibilityLabel={`Player ${player.player_id}${player.player_id === snapshot.your_player_id ? ", you" : ""}`} style={[styles.playerCell, styles.columnHeading]}>
              {player.player_id === snapshot.your_player_id ? 'You' : `P${player.player_id}`}
            </Text>)}
          </View>
          {Array.from({ length: 5 }, (_, i) => {
            const active = snapshot.deal?.deal_number === i + 1 && !snapshot.game?.finished;
            const history = snapshot.deal_history?.find(d => d.deal_number === i + 1);
            return <View key={i} style={[styles.statsRow, active && styles.activeDeal]}>
              <Text style={[styles.cell, active && styles.activeBid]}>Deal {i + 1}{active ? '\nActive' : ''}</Text>
              {(snapshot.players || []).map(player => {
                const score = snapshot.scoreboard?.find(p => p.player_id === player.player_id);
                const result = history?.players.find(p => p.player_id === player.player_id);
                const current = active ? snapshot.deal?.players.find(p => p.player_id === player.player_id) : undefined;
                const bid = current?.bid ?? result?.bid;
                const won = current?.tricks_won ?? result?.tricks_won;
                const points = score?.deal_scores_tenths[i];
                const missed = points != null && points < 0;
                return <View key={player.player_id} style={styles.playerCell}
                  accessibilityLabel={`Player ${player.player_id}, deal ${i + 1}${active ? ', active' : ''}, bid ${bid ?? 'pending'}, won ${won ?? 0}${points != null ? `, ${missed ? 'missed bid, ' : ''}score ${points / 10}` : ''}`}>
                  <Text numberOfLines={1} adjustsFontSizeToFit style={[styles.statValue, active && styles.activeBid]}>Bid {bid ?? '—'}</Text>
                  <Text numberOfLines={1} adjustsFontSizeToFit style={styles.statValue}>Won {won ?? '—'}</Text>
                  <View style={[styles.result, missed && styles.missed]}><Text numberOfLines={1} adjustsFontSizeToFit style={[styles.statValue, missed && styles.negative]}>{points == null ? '—' : `${points > 0 ? '+' : ''}${(points / 10).toFixed(1)}`}</Text></View>
                </View>;
              })}
            </View>;
          })}
          <View style={styles.statsRow}>
            <Text style={styles.cell}>Score</Text>
            {(snapshot.players || []).map(player => <Text key={player.player_id} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75} style={[styles.playerCell, styles.columnHeading]}>
              {((snapshot.scoreboard?.find(p => p.player_id === player.player_id)?.total_score_tenths ?? 0) / 10).toFixed(1)}
            </Text>)}
          </View>
          <View style={styles.statsRow}>
            <Text style={styles.cell}>Tricks</Text>
            {(snapshot.players || []).map(player => <Text key={player.player_id} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75} style={[styles.playerCell, styles.columnHeading]}>
              {snapshot.player_stats?.find(p => p.player_id === player.player_id)?.total_tricks_won ?? 0}
            </Text>)}
          </View>
        </View>
      </> : <>
        <Text style={styles.title}>Call Break rules</Text>
        <Text style={styles.text}>Five deals. Spades are trump. Follow suit and beat the leading card when possible. When void, play a winning spade if you can; otherwise discard. The trick winner leads next.</Text>
        <Text style={styles.text}>Bid 1–{snapshot.rules?.bid_max || Math.floor(52 / (snapshot.capacity || 4))}. Make your bid to score that many points, plus 0.1 per extra trick. Miss it and lose your bid. Highest total wins.</Text>
        <Text style={styles.text}>{editable ? 'Creator settings · save before starting' : 'Only the creator can edit settings before the game starts.'}</Text>
        {settings && <>
          {(['weak_hand_enabled', 'no_spades_enabled'] as const).map(key => <View key={key} style={styles.row}>
            <Switch accessibilityLabel={key === 'weak_hand_enabled' ? 'Allow weak hand redeal' : 'Allow no spades redeal'} disabled={!editable || busy} value={settings[key]} onValueChange={value => setDraft({ ...settings, [key]: value })} />
            <Text style={styles.text}>{key === 'weak_hand_enabled' ? 'Redeal with no card above Jack' : 'Redeal with no spades'}</Text>
          </View>)}
          <Text style={styles.title}>Placement bets · paid to first place</Text>
          {editable ? settings.payments.slice(0, (snapshot.capacity || 4) - 1).map((amount, i) => <View key={i} style={styles.row}>
            <Text style={styles.text}>{['2nd', '3rd', '4th', '5th'][i]} pays first</Text>
            <TextInput accessibilityLabel={`${i + 2} place payment`} editable={!!editable && !busy} keyboardType="number-pad" value={String(amount)} maxLength={7}
              onChangeText={text => { if (/^\d*$/.test(text)) setDraft({ ...settings, payments: settings.payments.map((v, index) => index === i ? Math.min(1000000, Number(text)) : v) }); }} style={styles.input} />
          </View>) : settings.payments.slice(0, (snapshot.capacity || 4) - 1).map((amount, i) =>
            <Text key={i} style={styles.text}>{['2nd', '3rd', '4th', '5th'][i]} place → 1st: {amount} units</Text>)}
          <Text style={styles.text}>Zero means no bet. Amounts record your agreement; no money is transferred. Tied placements require agreement between players.</Text>
          {editable && <Pressable accessibilityRole="button" disabled={busy} onPress={() => onSave(settings)} style={styles.button}><Text style={styles.label}>{busy ? 'Saving…' : 'Save rules & bets'}</Text></Pressable>}
        </>}
      </>}
    </ScrollView>}
  </View>;
}
const createStyles = (colors: ThemeColors) => StyleSheet.create({
  sidebar: { flex: 1, minHeight: 0, borderBottomWidth: 0, paddingHorizontal: 12 },
  sidebarDetails: { flex: 1, minHeight: 0 },
  selectedTab: { backgroundColor: colors.surfaceSelected, borderBottomWidth: 2, borderColor: colors.accent },
  panel: { paddingHorizontal: 16, borderBottomWidth: 1, borderColor: colors.border }, row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  button: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 12 }, label: { fontFamily: fonts.medium, fontSize: 12, color: colors.accent },
  details: { maxHeight: 320 }, title: { fontFamily: fonts.display, fontSize: 23, color: colors.text }, text: { fontFamily: fonts.body, color: colors.textMuted, fontSize: 12, lineHeight: 21, flexShrink: 1 },
  statsTable: { width: '100%', borderWidth: 1, borderColor: colors.border, borderRadius: 8, overflow: 'hidden' },
  statsRow: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderColor: colors.surfaceSelected },
  playerCell: { flex: 1, minWidth: 0, paddingHorizontal: 2, paddingVertical: 8, alignItems: 'center', justifyContent: 'center', gap: 2 },
  statValue: { fontFamily: fonts.body, color: colors.textMuted, fontSize: 11, lineHeight: 20, textAlign: 'center', fontVariant: ['tabular-nums'], maxWidth: '100%' },
  columnHeading: { fontFamily: fonts.medium, color: colors.text, fontSize: 12, textAlign: 'center', fontVariant: ['tabular-nums'] }, activeDeal: { backgroundColor: colors.surface, borderRadius: 8 }, activeBid: { color: colors.accent, fontFamily: fonts.medium },
  result: { alignSelf: 'center', maxWidth: '100%', paddingHorizontal: 3, borderWidth: 1, borderColor: 'transparent', borderRadius: 24 }, missed: { borderColor: colors.danger, backgroundColor: colors.dangerSurface }, negative: { color: colors.danger },
  cell: { width: 52, flexShrink: 0, color: colors.text, fontFamily: fonts.medium, fontSize: 11, lineHeight: 20, paddingVertical: 8, paddingLeft: 6 }, input: { width: 100, minHeight: 44, padding: 10, color: colors.text, borderWidth: 1, borderColor: colors.textMuted, borderRadius: 8 },
});
