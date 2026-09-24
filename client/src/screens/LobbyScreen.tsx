import { ui } from '../i18n/copy.ts';
import { useUiLanguage } from '../i18n/useUiLanguage';
import { gameControlFinish, gameHeadingFinish, gamePanelFinish, fonts, useTheme, useThemedStyles, type ThemeColors } from '../theme';
import { FormInput, FormScrollView } from '../components/FormInput';
import { KeyboardFrame } from '../components/KeyboardFrame';
import { AppHeader } from '../components/AppHeader';
import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CallBreakTableScreen } from './CallBreakTableScreen';

type Table = { code: string; name: string; capacity: 4 | 5; players: string[]; playing?: boolean };

// Design fixtures only. No server rooms or identities are created by this screen.
const sampleTables: Table[] = [
  { code: 'CHAI42', name: 'Chiya & cards', capacity: 4, players: ['Aashish', 'Nisha'] },
  { code: 'FIVE05', name: 'One more round', capacity: 5, players: ['Samir', 'Maya', 'Rohan'] },
  { code: 'NIGHT4', name: 'The night table', capacity: 4, players: ['Anu', 'Suman', 'Bina', 'Kiran'], playing: true },
];

function Action({ label, onPress, secondary = false, disabled = false, caption }: {
  caption?: string; label: string; onPress: () => void; secondary?: boolean; disabled?: boolean;
}) {
  const uiLanguage = useUiLanguage();
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  return <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled}
    accessibilityState={{ disabled }} onPress={onPress} style={({ pressed }) => [
      styles.action, secondary && styles.secondary, (disabled || pressed) && { opacity: 0.5 },
    ]}><Text style={[styles.actionLabel, secondary && { color: colors.text }]}>{caption || label}</Text></Pressable>;
}

export function LobbyScreen({ onLeave, onBack, roomCode }: { onLeave: () => void; onBack: () => void; roomCode: string }) {
  const uiLanguage = useUiLanguage();
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const wide = useWindowDimensions().width >= 960;
  const insets = useSafeAreaInsets();
  const [capacity, setCapacity] = useState<4 | 5>(4);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<'all' | 'open'>("all");
  const [seated, setSeated] = useState<Table | null>(null);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [tablePreview, setTablePreview] = useState<Table | null>(null);

  function join(table: Table) {
    if (table.playing || table.players.length >= table.capacity) {
      setError(ui("feedback.that_table_is_full_choose_a_table_with_an_open_seat")); return;
    }
    setError('');
    setSeated({ ...table, players: [...table.players, ui("common.you")] });
  }

  if (tablePreview) return <CallBreakTableScreen capacity={tablePreview.capacity} names={tablePreview.players}
    tableName={tablePreview.name} onBack={() => setTablePreview(null)} />;

  return <KeyboardFrame><LinearGradient colors={[colors.surface, colors.background]} style={styles.page}>
    <FormScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.scroll, {
      paddingTop: Math.max(insets.top, 24), paddingBottom: Math.max(insets.bottom, 28),
      paddingLeft: Math.max(insets.left, wide ? 40 : 20), paddingRight: Math.max(insets.right, wide ? 40 : 20),
    }]}>
      <View style={styles.content}>
        <AppHeader actions={<Pressable accessibilityRole="button" onPress={onLeave} style={styles.exit}><Text style={{ color: colors.accent }}>{ui("common.exit_preview")}</Text></Pressable>} />
        <View style={styles.hero}>
          <Pressable accessibilityRole="button" onPress={onBack} style={styles.exit}><Text style={styles.lightLink}>{ui("common.all_games_arrow")}</Text></Pressable>
          <Text style={styles.eyebrow}>{ui("common.callbreak_room")}</Text>
          <Text accessibilityRole="header" style={[styles.title, !wide && { fontSize: 43 }]}>{ui("rooms.ready_for_a_round")}</Text>
          <Text style={styles.subtitle}>A familiar game. A little friendly rivalry. Take a seat.</Text>
        </View>
        <View style={styles.preview}><Text style={styles.previewText}>Design preview · Sample tables only. Nothing is connected yet.</Text></View>

        <View style={[styles.columns, wide && styles.wideColumns]}>
          <View style={[styles.controls, wide && { width: 340 }]}>
            <View style={styles.panel}>
              <Text style={styles.copperIcon}>♠</Text>
              <Text accessibilityRole="header" style={styles.panelTitle}>{ui("common.preview_a_card_table")}</Text>
              <Text style={styles.description}>Try the local layout. To create a shared game, use Create game in the room header.</Text>
              <Text style={styles.label}>{ui("rooms.your_shareable_table_code")}</Text>
              <Text selectable accessibilityLabel={ui("common.shareable_table_code_code", { "code": roomCode })} style={styles.inviteCode}>{roomCode}</Text>
              <Text style={styles.label}>{ui("rooms.seats_at_the_table")}</Text>
              <View style={styles.segments}>
                {([4, 5] as const).map(size => <Pressable key={size} accessibilityRole="button"
                  accessibilityState={{ selected: capacity === size }} onPress={() => setCapacity(size)}
                  style={[styles.segment, capacity === size && styles.segmentSelected]}>
                  <Text style={[styles.segmentText, capacity === size && { color: colors.accent }]}>{ui("rooms.count_players", { "count": size })}</Text>
                </Pressable>)}
              </View>
              <Text nativeID="table-name-label" style={styles.label}>{ui("rooms.table_name")}</Text><View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <FormInput accessibilityLabel={ui("rooms.table_name")} value={name} onChangeText={setName} maxLength={40}
                placeholder={ui("common.friday_with_friends")} placeholderTextColor={colors.textMuted} style={[styles.input, { flex: 1, minWidth: 0 }]} />
              <Action label={ui("common.create_table_preview")} caption={ui("rooms.create")} onPress={() => {
                setError(''); setSeated({ code: roomCode, name: name.trim() || 'Your table', capacity, players: [ui("common.you")] });
              }} /></View>
            </View>
            <View style={styles.panel}>
              <Text accessibilityRole="header" style={styles.panelTitle}>{ui("rooms.invite_your_friends")}</Text>
              <Text style={styles.description}>Share the table code above. Friends enter it on the room list, then choose Join game. It is the same code shown to the room creator.</Text>
              {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
              <Action label={ui("common.go_to_room_list_to_enter_a_code")} secondary onPress={onLeave} />
            </View>
          </View>

          <View style={[styles.panel, styles.directory]}>
            <View style={styles.directoryHeader}>
              <Text accessibilityRole="header" style={styles.panelTitle}>{ui("rooms.find_your_next_table")}</Text>
              <Text style={styles.sampleLabel}>{ui("common.sample_tables")}</Text>
            </View>
            <Text style={styles.description}>{ui("common.there_s_always_room_for_one_more_round")}</Text>
            <View style={styles.filters}>
              {(["all", "open"] as const).map(value => <Pressable key={value} accessibilityRole="button"
                accessibilityState={{ selected: filter === value }} onPress={() => setFilter(value)}
                style={[styles.filter, filter === value && styles.filterSelected]}>
                <Text style={[styles.filterText, filter === value && { color: colors.text }]}>{value === 'all' ? ui("rooms.all_tables") : ui("rooms.open_seats")}</Text>
              </Pressable>)}
            </View>
            {sampleTables.filter(table => filter === 'all' || !table.playing && table.players.length < table.capacity).map(table => (
              <View key={table.code} style={styles.table}>
                <View style={styles.tableHeading}>
                  <Text style={styles.tableName}>{table.name}</Text>
                  <Text style={[styles.tableStatus, table.playing && { color: colors.textMuted }]}>{table.playing ? ui("rooms.playing") : ui("rooms.waiting")}</Text>
                </View>
                <Text style={styles.tableMeta}>{ui("common.count_players_5_deals_local_preview", { "count": table.capacity })}</Text>
                <View style={styles.tableBottom}>
                  <View style={styles.seatSummary}>
                    <View style={styles.miniSeats}>{Array.from({ length: table.capacity }, (_, index) => (
                      <View key={index} style={[styles.miniSeat, index >= table.players.length && styles.emptyMiniSeat]}>
                        <Text style={styles.miniSeatText}>{table.players[index]?.[0] || '+'}</Text>
                      </View>
                    ))}</View>
                    <Text style={styles.tableMeta}>{ui("rooms.seated_capacity_seated", { "seated": table.players.length, "capacity": table.capacity })}</Text>
                  </View>
                  <Action label={table.playing ? ui("rooms.table_full") : ui("common.join_tablename", { "tableName": table.name })} disabled={table.playing} secondary onPress={() => join(table)} />
                </View>
              </View>
            ))}
            <View style={styles.rulesRow}>
              <Text style={styles.description}>{ui("common.new_to_call_break")}</Text>
              <Pressable accessibilityRole="button" onPress={() => setRulesOpen(true)} style={styles.exit}><Text style={styles.copperLink}>{ui("common.how_play_arrow")}</Text></Pressable>
            </View>
          </View>
        </View>
        <Text style={styles.bottomNote}>{ui("common.good_cards_better_company")}</Text>
      </View>
    </FormScrollView>

    <Modal visible={!!seated || rulesOpen} transparent animationType="fade" onRequestClose={() => { setSeated(null); setRulesOpen(false); }}>
      <View style={[styles.overlay, { paddingTop: Math.max(insets.top, 20), paddingBottom: Math.max(insets.bottom, 20) }]}>
        <View accessibilityViewIsModal style={styles.modal}>
          <FormScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.modalContent}>
            {seated ? <>
              <Text style={styles.sampleLabel}>{ui("common.waiting_room_preview")}</Text>
              <Text accessibilityRole="header" style={styles.modalTitle}>{seated.name}</Text>
              <Text style={styles.description}>Your seat is ready. This is how the table will look while friends arrive.</Text>
              <View style={styles.invite}><Text style={styles.label}>{ui("rooms.shared_room_table_code")}</Text><Text selectable style={styles.inviteCode}>{roomCode}</Text></View>
              {Array.from({ length: seated.capacity }, (_, index) => <View key={index} style={styles.waitingSeat}>
                <Text style={styles.seatNumber}>{index + 1}</Text>
                <Text style={styles.playerName}>{seated.players[index] || ui("rooms.waiting_for_a_friend")}</Text>
                {seated.players[index] === 'You' && <Text style={styles.tableStatus}>{ui("common.you")}</Text>}
              </View>)}
              <Text style={styles.modalNote}>The code joins your shared room. This card table is a local preview; create or join the shared game using the room header.</Text>
              <Action label={ui("common.preview_card_table")} onPress={() => { setTablePreview(seated); setSeated(null); }} />
            </> : <>
              <Text style={styles.sampleLabel}>{ui("rooms.call_break")}</Text>
              <Text accessibilityRole="header" style={styles.modalTitle}>{ui("common.a_quick_refresher")}</Text>
              <Text style={styles.rulesText}>1. Bid how many tricks you think you can win.{'\n\n'}2. Follow the led suit and beat the winning card when possible. Spades are trump.{'\n\n'}3. Meet your bid to score. The highest total after five deals wins.</Text>
            </>}
            <Action label={ui("common.back_to_lobby")} onPress={() => { setSeated(null); setRulesOpen(false); }} />
          </FormScrollView>
        </View>
      </View>
    </Modal>
  </LinearGradient></KeyboardFrame>;
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  page: { flex: 1 }, scroll: { flexGrow: 1, alignItems: 'center' }, content: { width: '100%', maxWidth: 1160 },
  topbar: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingBottom: 22, borderBottomWidth: 1, borderColor: colors.border },
  brand: { fontFamily: fonts.display, fontSize: 31, color: colors.accent },
  account: { flexDirection: 'row', alignItems: 'center', gap: 10 }, avatar: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.surfaceSelected, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontFamily: fonts.medium, color: colors.accent }, accountName: { fontFamily: fonts.medium, fontSize: 13, color: colors.text },
  exit: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 8 }, lightLink: { fontFamily: fonts.body, color: colors.textMuted, fontSize: 12 },
  hero: { paddingTop: 36, paddingBottom: 24, gap: 10 }, eyebrow: { fontFamily: fonts.medium, color: colors.accent, fontSize: 10, letterSpacing: 3 },
  title: { ...gameHeadingFinish(colors), fontFamily: fonts.display, fontSize: 60, color: colors.text }, subtitle: { fontFamily: fonts.body, color: colors.textMuted, fontSize: 14, lineHeight: 23 },
  preview: { paddingBottom: 20 }, previewText: { fontFamily: fonts.body, color: colors.textMuted, fontSize: 11, lineHeight: 18 },
  columns: { gap: 22 }, wideColumns: { flexDirection: 'row', alignItems: 'flex-start' }, controls: { gap: 22 },
  panel: { ...gamePanelFinish(colors), backgroundColor: colors.surface, borderRadius: 18, padding: 24 }, copperIcon: { fontSize: 28, color: colors.accent, marginBottom: 10 },
  panelTitle: { ...gameHeadingFinish(colors), fontFamily: fonts.display, fontSize: 28, color: colors.text, flexShrink: 1 }, description: { fontFamily: fonts.body, fontSize: 12, lineHeight: 20, color: colors.textMuted, marginTop: 6 },
  label: { fontFamily: fonts.medium, fontSize: 11, color: colors.text, marginTop: 20, marginBottom: 8 },
  input: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 9, padding: 13, minHeight: 48, fontFamily: fonts.body, fontSize: 13, color: colors.text },
  codeInput: { marginTop: 18, marginBottom: 12, letterSpacing: 2 }, segments: { flexDirection: 'row', gap: 8, marginBottom: 20 },
  segment: { ...gameControlFinish(colors), flex: 1, minHeight: 46, borderWidth: 1, borderColor: colors.border, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  segmentSelected: { borderColor: colors.accent, backgroundColor: colors.surfaceSelected }, segmentText: { fontFamily: fonts.medium, color: colors.textMuted, fontSize: 12 },
  action: { ...gameControlFinish(colors), minHeight: 46, borderRadius: 9, backgroundColor: colors.primary, paddingHorizontal: 16, paddingVertical: 13, justifyContent: 'center', alignItems: 'center' },
  actionLabel: { fontFamily: fonts.medium, fontSize: 12, color: colors.onPrimary, textAlign: 'center' }, secondary: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.border },
  error: { color: colors.danger, fontFamily: fonts.body, fontSize: 12, lineHeight: 19, marginBottom: 12 },
  directory: { flex: 1, minWidth: 0 }, directoryHeader: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  sampleLabel: { fontFamily: fonts.medium, fontSize: 9, letterSpacing: 1.5, color: colors.accent },
  filters: { flexDirection: 'row', gap: 8, marginTop: 22, marginBottom: 8 }, filter: { ...gameControlFinish(colors), minHeight: 44, paddingHorizontal: 15, justifyContent: 'center', borderRadius: 22 },
  filterSelected: { backgroundColor: colors.surfaceSelected }, filterText: { fontFamily: fonts.medium, fontSize: 12, color: colors.textMuted },
  table: { paddingVertical: 23, borderBottomWidth: 1, borderColor: colors.border, gap: 8 },
  tableHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 }, tableName: { fontFamily: fonts.medium, fontSize: 15, color: colors.text, flex: 1 },
  tableStatus: { fontFamily: fonts.medium, fontSize: 10, color: colors.accent }, tableMeta: { fontFamily: fonts.body, fontSize: 11, color: colors.textMuted, lineHeight: 18 },
  tableBottom: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 14, marginTop: 8 },
  seatSummary: { gap: 6 }, miniSeats: { flexDirection: 'row', gap: 5 }, miniSeat: { width: 29, height: 29, borderRadius: 15, backgroundColor: colors.surface, justifyContent: 'center', alignItems: 'center' },
  emptyMiniSeat: { backgroundColor: 'transparent', borderWidth: 1, borderStyle: 'dashed', borderColor: colors.textMuted }, miniSeatText: { fontFamily: fonts.medium, fontSize: 10, color: colors.textMuted },
  rulesRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', paddingTop: 18 }, copperLink: { fontFamily: fonts.medium, color: colors.accent, fontSize: 12 },
  bottomNote: { fontFamily: fonts.display, color: colors.textMuted, fontSize: 21, textAlign: 'center', marginTop: 28 },
  overlay: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 20 }, modal: { ...gamePanelFinish(colors), width: '100%', maxWidth: 460, maxHeight: '100%', backgroundColor: colors.surface, borderRadius: 20 },
  modalContent: { padding: 26 }, modalTitle: { ...gameHeadingFinish(colors), fontFamily: fonts.display, fontSize: 36, color: colors.text, marginTop: 12 },
  invite: { alignItems: 'center', backgroundColor: colors.surface, borderRadius: 12, marginVertical: 20, paddingBottom: 18 }, inviteCode: { fontFamily: fonts.medium, fontSize: 21, letterSpacing: 1, color: colors.text },
  waitingSeat: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52, borderBottomWidth: 1, borderColor: colors.border }, seatNumber: { fontFamily: fonts.medium, color: colors.accent, fontSize: 12 }, playerName: { flex: 1, fontFamily: fonts.body, fontSize: 13, color: colors.text },
  modalNote: { fontFamily: fonts.body, fontSize: 11, lineHeight: 18, color: colors.textMuted, marginVertical: 20 }, rulesText: { fontFamily: fonts.body, fontSize: 14, lineHeight: 23, color: colors.text, marginVertical: 24 },
});
