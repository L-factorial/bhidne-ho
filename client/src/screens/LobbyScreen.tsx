import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, fonts } from '../theme';
import { CallBreakTableScreen } from './CallBreakTableScreen';

type Table = { code: string; name: string; capacity: 4 | 5; players: string[]; playing?: boolean };

// Design fixtures only. No server rooms or identities are created by this screen.
const sampleTables: Table[] = [
  { code: 'CHAI42', name: 'Chiya & cards', capacity: 4, players: ['Aashish', 'Nisha'] },
  { code: 'FIVE05', name: 'One more round', capacity: 5, players: ['Samir', 'Maya', 'Rohan'] },
  { code: 'NIGHT4', name: 'The night table', capacity: 4, players: ['Anu', 'Suman', 'Bina', 'Kiran'], playing: true },
];

function Action({ label, onPress, secondary = false, disabled = false }: {
  label: string; onPress: () => void; secondary?: boolean; disabled?: boolean;
}) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled}
    accessibilityState={{ disabled }} onPress={onPress} style={({ pressed }) => [
      styles.action, secondary && styles.secondary, (disabled || pressed) && { opacity: 0.5 },
    ]}><Text style={[styles.actionLabel, secondary && { color: colors.ink }]}>{label}</Text></Pressable>;
}

export function LobbyScreen({ onLeave, onBack, roomCode }: { onLeave: () => void; onBack: () => void; roomCode: string }) {
  const wide = useWindowDimensions().width >= 960;
  const insets = useSafeAreaInsets();
  const [capacity, setCapacity] = useState<4 | 5>(4);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<'all' | 'open'>('all');
  const [seated, setSeated] = useState<Table | null>(null);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [tablePreview, setTablePreview] = useState<Table | null>(null);

  function join(table: Table) {
    if (table.playing || table.players.length >= table.capacity) {
      setError('That table is full. Choose a table with an open seat.'); return;
    }
    setError('');
    setSeated({ ...table, players: [...table.players, 'You'] });
  }

  if (tablePreview) return <CallBreakTableScreen capacity={tablePreview.capacity} names={tablePreview.players}
    tableName={tablePreview.name} onBack={() => setTablePreview(null)} />;

  return <LinearGradient colors={[colors.navyLight, colors.navy]} style={styles.page}>
    <ScrollView contentContainerStyle={[styles.scroll, {
      paddingTop: Math.max(insets.top, 24), paddingBottom: Math.max(insets.bottom, 28),
      paddingLeft: Math.max(insets.left, wide ? 40 : 20), paddingRight: Math.max(insets.right, wide ? 40 : 20),
    }]}>
      <View style={styles.content}>
        <View style={styles.topbar}>
          <Text style={styles.brand}>♠ Bhidne Ho</Text>
          <View style={styles.account}>
            <View style={styles.avatar}><Text style={styles.avatarText}>G</Text></View>
            <Text style={styles.accountName}>Guest</Text>
            <Pressable accessibilityRole="button" onPress={onLeave} style={styles.exit}><Text style={styles.lightLink}>Exit preview</Text></Pressable>
          </View>
        </View>
        <View style={styles.hero}>
          <Pressable accessibilityRole="button" onPress={onBack} style={styles.exit}><Text style={styles.lightLink}>← All games</Text></Pressable>
          <Text style={styles.eyebrow}>CALL BREAK GAME ROOM</Text>
          <Text accessibilityRole="header" style={[styles.title, !wide && { fontSize: 43 }]}>Ready for a round?</Text>
          <Text style={styles.subtitle}>A familiar game. A little friendly rivalry. Take a seat.</Text>
        </View>
        <View style={styles.preview}><Text style={styles.previewText}>Design preview · Sample tables only. Nothing is connected yet.</Text></View>

        <View style={[styles.columns, wide && styles.wideColumns]}>
          <View style={[styles.controls, wide && { width: 340 }]}>
            <View style={styles.panel}>
              <Text style={styles.copperIcon}>♠</Text>
              <Text accessibilityRole="header" style={styles.panelTitle}>Preview a card table</Text>
              <Text style={styles.description}>Try the local layout. To create a shared game, use Create game in the room header.</Text>
              <Text style={styles.label}>Your shareable table code</Text>
              <Text selectable accessibilityLabel={`Shareable table code ${roomCode}`} style={styles.inviteCode}>{roomCode}</Text>
              <Text nativeID="table-name-label" style={styles.label}>Table name</Text>
              <TextInput accessibilityLabel="Table name" value={name} onChangeText={setName} maxLength={40}
                placeholder="e.g. Friday with friends" placeholderTextColor={colors.muted} style={styles.input} />
              <Text style={styles.label}>Seats at the table</Text>
              <View style={styles.segments}>
                {([4, 5] as const).map(size => <Pressable key={size} accessibilityRole="button"
                  accessibilityState={{ selected: capacity === size }} onPress={() => setCapacity(size)}
                  style={[styles.segment, capacity === size && styles.segmentSelected]}>
                  <Text style={[styles.segmentText, capacity === size && { color: colors.copper }]}>{size} players</Text>
                </Pressable>)}
              </View>
              <Action label="Create table preview" onPress={() => {
                setError(''); setSeated({ code: roomCode, name: name.trim() || 'Your table', capacity, players: ['You'] });
              }} />
            </View>
            <View style={styles.panel}>
              <Text accessibilityRole="header" style={styles.panelTitle}>Invite your friends</Text>
              <Text style={styles.description}>Share the table code above. Friends enter it on the room list, then choose Join game. It is the same code shown to the room creator.</Text>
              {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
              <Action label="Go to room list to enter a code" secondary onPress={onLeave} />
            </View>
          </View>

          <View style={[styles.panel, styles.directory]}>
            <View style={styles.directoryHeader}>
              <Text accessibilityRole="header" style={styles.panelTitle}>Find your next table</Text>
              <Text style={styles.sampleLabel}>SAMPLE TABLES</Text>
            </View>
            <Text style={styles.description}>There’s always room for one more round.</Text>
            <View style={styles.filters}>
              {(['all', 'open'] as const).map(value => <Pressable key={value} accessibilityRole="button"
                accessibilityState={{ selected: filter === value }} onPress={() => setFilter(value)}
                style={[styles.filter, filter === value && styles.filterSelected]}>
                <Text style={[styles.filterText, filter === value && { color: colors.ivory }]}>{value === 'all' ? 'All tables' : 'Open seats'}</Text>
              </Pressable>)}
            </View>
            {sampleTables.filter(table => filter === 'all' || !table.playing && table.players.length < table.capacity).map(table => (
              <View key={table.code} style={styles.table}>
                <View style={styles.tableHeading}>
                  <Text style={styles.tableName}>{table.name}</Text>
                  <Text style={[styles.tableStatus, table.playing && { color: colors.muted }]}>{table.playing ? 'Playing' : 'Waiting'}</Text>
                </View>
                <Text style={styles.tableMeta}>{table.capacity} players · 5 deals · Local preview</Text>
                <View style={styles.tableBottom}>
                  <View style={styles.seatSummary}>
                    <View style={styles.miniSeats}>{Array.from({ length: table.capacity }, (_, index) => (
                      <View key={index} style={[styles.miniSeat, index >= table.players.length && styles.emptyMiniSeat]}>
                        <Text style={styles.miniSeatText}>{table.players[index]?.[0] || '+'}</Text>
                      </View>
                    ))}</View>
                    <Text style={styles.tableMeta}>{table.players.length}/{table.capacity} seated</Text>
                  </View>
                  <Action label={table.playing ? 'Table full' : `Join ${table.name}`} disabled={table.playing} secondary onPress={() => join(table)} />
                </View>
              </View>
            ))}
            <View style={styles.rulesRow}>
              <Text style={styles.description}>New to Call Break?</Text>
              <Pressable accessibilityRole="button" onPress={() => setRulesOpen(true)} style={styles.exit}><Text style={styles.copperLink}>How to play ↗</Text></Pressable>
            </View>
          </View>
        </View>
        <Text style={styles.bottomNote}>Good cards. Better company.</Text>
      </View>
    </ScrollView>

    <Modal visible={!!seated || rulesOpen} transparent animationType="fade" onRequestClose={() => { setSeated(null); setRulesOpen(false); }}>
      <View style={[styles.overlay, { paddingTop: Math.max(insets.top, 20), paddingBottom: Math.max(insets.bottom, 20) }]}>
        <View accessibilityViewIsModal style={styles.modal}>
          <ScrollView contentContainerStyle={styles.modalContent}>
            {seated ? <>
              <Text style={styles.sampleLabel}>WAITING ROOM PREVIEW</Text>
              <Text accessibilityRole="header" style={styles.modalTitle}>{seated.name}</Text>
              <Text style={styles.description}>Your seat is ready. This is how the table will look while friends arrive.</Text>
              <View style={styles.invite}><Text style={styles.label}>Shared room table code</Text><Text selectable style={styles.inviteCode}>{roomCode}</Text></View>
              {Array.from({ length: seated.capacity }, (_, index) => <View key={index} style={styles.waitingSeat}>
                <Text style={styles.seatNumber}>{index + 1}</Text>
                <Text style={styles.playerName}>{seated.players[index] || 'Waiting for a friend…'}</Text>
                {seated.players[index] === 'You' && <Text style={styles.tableStatus}>You</Text>}
              </View>)}
              <Text style={styles.modalNote}>The code joins your shared room. This card table is a local preview; create or join the shared game using the room header.</Text>
              <Action label="Preview card table" onPress={() => { setTablePreview(seated); setSeated(null); }} />
            </> : <>
              <Text style={styles.sampleLabel}>CALL BREAK</Text>
              <Text accessibilityRole="header" style={styles.modalTitle}>A quick refresher</Text>
              <Text style={styles.rulesText}>1. Bid how many tricks you think you can win.{'\n\n'}2. Follow the led suit and beat the winning card when possible. Spades are trump.{'\n\n'}3. Meet your bid to score. The highest total after five deals wins.</Text>
            </>}
            <Action label="Back to lobby" onPress={() => { setSeated(null); setRulesOpen(false); }} />
          </ScrollView>
        </View>
      </View>
    </Modal>
  </LinearGradient>;
}

const styles = StyleSheet.create({
  page: { flex: 1 }, scroll: { flexGrow: 1, alignItems: 'center' }, content: { width: '100%', maxWidth: 1160 },
  topbar: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingBottom: 22, borderBottomWidth: 1, borderColor: '#FFFFFF1A' },
  brand: { fontFamily: fonts.display, fontSize: 31, color: colors.champagne },
  account: { flexDirection: 'row', alignItems: 'center', gap: 10 }, avatar: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#EBC29F22', alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontFamily: fonts.medium, color: colors.champagne }, accountName: { fontFamily: fonts.medium, fontSize: 13, color: colors.ivory },
  exit: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 8 }, lightLink: { fontFamily: fonts.body, color: '#D9C6B7', fontSize: 12 },
  hero: { paddingTop: 36, paddingBottom: 24, gap: 10 }, eyebrow: { fontFamily: fonts.medium, color: colors.champagne, fontSize: 10, letterSpacing: 3 },
  title: { fontFamily: fonts.display, fontSize: 60, color: colors.ivory }, subtitle: { fontFamily: fonts.body, color: '#C1CBD5', fontSize: 14, lineHeight: 23 },
  preview: { paddingBottom: 20 }, previewText: { fontFamily: fonts.body, color: '#B4C1CF', fontSize: 11, lineHeight: 18 },
  columns: { gap: 22 }, wideColumns: { flexDirection: 'row', alignItems: 'flex-start' }, controls: { gap: 22 },
  panel: { backgroundColor: colors.ivory, borderRadius: 18, padding: 24 }, copperIcon: { fontSize: 28, color: colors.copper, marginBottom: 10 },
  panelTitle: { fontFamily: fonts.display, fontSize: 28, color: colors.ink, flexShrink: 1 }, description: { fontFamily: fonts.body, fontSize: 12, lineHeight: 20, color: colors.muted, marginTop: 6 },
  label: { fontFamily: fonts.medium, fontSize: 11, color: colors.ink, marginTop: 20, marginBottom: 8 },
  input: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: colors.line, borderRadius: 9, padding: 13, minHeight: 48, fontFamily: fonts.body, fontSize: 13, color: colors.ink },
  codeInput: { marginTop: 18, marginBottom: 12, letterSpacing: 2 }, segments: { flexDirection: 'row', gap: 8, marginBottom: 20 },
  segment: { flex: 1, minHeight: 46, borderWidth: 1, borderColor: colors.line, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  segmentSelected: { borderColor: colors.copper, backgroundColor: '#A65A3A0D' }, segmentText: { fontFamily: fonts.medium, color: colors.muted, fontSize: 12 },
  action: { minHeight: 46, borderRadius: 9, backgroundColor: colors.copper, paddingHorizontal: 16, paddingVertical: 13, justifyContent: 'center', alignItems: 'center' },
  actionLabel: { fontFamily: fonts.medium, fontSize: 12, color: '#FFFFFF', textAlign: 'center' }, secondary: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.line },
  error: { color: '#9C352C', fontFamily: fonts.body, fontSize: 12, lineHeight: 19, marginBottom: 12 },
  directory: { flex: 1, minWidth: 0 }, directoryHeader: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  sampleLabel: { fontFamily: fonts.medium, fontSize: 9, letterSpacing: 1.5, color: colors.copper },
  filters: { flexDirection: 'row', gap: 8, marginTop: 22, marginBottom: 8 }, filter: { minHeight: 44, paddingHorizontal: 15, justifyContent: 'center', borderRadius: 22 },
  filterSelected: { backgroundColor: colors.ink }, filterText: { fontFamily: fonts.medium, fontSize: 12, color: colors.muted },
  table: { paddingVertical: 23, borderBottomWidth: 1, borderColor: colors.line, gap: 8 },
  tableHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 }, tableName: { fontFamily: fonts.medium, fontSize: 15, color: colors.ink, flex: 1 },
  tableStatus: { fontFamily: fonts.medium, fontSize: 10, color: colors.copper }, tableMeta: { fontFamily: fonts.body, fontSize: 11, color: colors.muted, lineHeight: 18 },
  tableBottom: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 14, marginTop: 8 },
  seatSummary: { gap: 6 }, miniSeats: { flexDirection: 'row', gap: 5 }, miniSeat: { width: 29, height: 29, borderRadius: 15, backgroundColor: '#E8DFD3', justifyContent: 'center', alignItems: 'center' },
  emptyMiniSeat: { backgroundColor: 'transparent', borderWidth: 1, borderStyle: 'dashed', borderColor: '#BEB5A8' }, miniSeatText: { fontFamily: fonts.medium, fontSize: 10, color: colors.muted },
  rulesRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', paddingTop: 18 }, copperLink: { fontFamily: fonts.medium, color: colors.copper, fontSize: 12 },
  bottomNote: { fontFamily: fonts.display, color: '#C5B8AC', fontSize: 21, textAlign: 'center', marginTop: 28 },
  overlay: { flex: 1, backgroundColor: '#020A14BB', justifyContent: 'center', alignItems: 'center', paddingHorizontal: 20 }, modal: { width: '100%', maxWidth: 460, maxHeight: '100%', backgroundColor: colors.ivory, borderRadius: 20 },
  modalContent: { padding: 26 }, modalTitle: { fontFamily: fonts.display, fontSize: 36, color: colors.ink, marginTop: 12 },
  invite: { alignItems: 'center', backgroundColor: '#EEE7DD', borderRadius: 12, marginVertical: 20, paddingBottom: 18 }, inviteCode: { fontFamily: fonts.medium, fontSize: 21, letterSpacing: 1, color: colors.ink },
  waitingSeat: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52, borderBottomWidth: 1, borderColor: colors.line }, seatNumber: { fontFamily: fonts.medium, color: colors.copper, fontSize: 12 }, playerName: { flex: 1, fontFamily: fonts.body, fontSize: 13, color: colors.ink },
  modalNote: { fontFamily: fonts.body, fontSize: 11, lineHeight: 18, color: colors.muted, marginVertical: 20 }, rulesText: { fontFamily: fonts.body, fontSize: 14, lineHeight: 23, color: colors.ink, marginVertical: 24 },
});
