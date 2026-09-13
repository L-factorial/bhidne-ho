import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { RoomSnapshot } from '../screens/LiveGameTable';
import type { MarriagePublic } from '../multiplayer/marriage';
import { physicalLabel } from '../multiplayer/marriage';
import { MarriageScoring, MarriagePoints } from './MarriageScoring';
import { fonts, useThemedStyles, type ThemeColors } from '../theme';

type Player = MarriagePublic['players'][number];
const route = (p: Player) => p.route === 'dublee' ? '7 Dublees' : p.route === 'normal' ? '3 sequences / Tunnelas' : 'Not shown';
const situation = (p: Player, pub: MarriagePublic) => p.finished ? 'Winner' : pub.current_player_id === p.player_id
  ? pub.phase === 'must_draw' ? 'Taking a card' : 'Showing or discarding' : 'Waiting for turn';
const playerName = (snapshot: RoomSnapshot, id: string) => snapshot.players?.find(p => String(p.player_id) === id)?.display_name || `Player ${id}`;

export function MarriagePlayers({ snapshot, onPoke, registerSeat }: { snapshot: RoomSnapshot; onPoke: (seat: number) => void; registerSeat?: (seat: string, node: View | null) => void }) {
  const styles = useThemedStyles(createStyles);
  const [selected, setSelected] = useState<string | null>(null);
  const insets = useSafeAreaInsets();
  const pub = snapshot.marriage!.public, mine = snapshot.marriage?.private?.player_id;
  const detail = pub.players.find(p => p.player_id === selected);
  return <>
    <View testID="marriage-player-grid" style={styles.grid}>
      {pub.players.map(p => <Pressable ref={node => registerSeat?.(p.player_id, node)} key={p.player_id}
        testID={`marriage-player-${p.player_id}`} accessibilityRole="button"
        accessibilityLabel={`${playerName(snapshot, p.player_id)}${p.player_id === mine ? ', You' : ''}, ${p.has_seen_maal ? 'Maal seen' : 'Maal not seen'}. View player details`}
        onPress={() => setSelected(p.player_id)} style={[styles.seat, p.has_seen_maal && styles.seenSeat, pub.current_player_id === p.player_id && styles.active]}>
        <Text numberOfLines={1} style={[styles.name, { flexShrink: 1 }]}>{playerName(snapshot, p.player_id)}{p.player_id === mine ? ' · You' : ''}</Text>
        {pub.current_player_id === p.player_id && <Text style={styles.small}>● Turn</Text>}
      </Pressable>)}
    </View>
    <Modal transparent visible={!!detail} animationType="none" onRequestClose={() => setSelected(null)}>
      <View style={[styles.backdrop, { paddingTop: Math.max(16, insets.top), paddingBottom: Math.max(16, insets.bottom) }]}>
        <View accessibilityViewIsModal testID="marriage-player-details" style={styles.dialog}>
          <View style={styles.dialogHeader}><Text accessibilityRole="header" style={styles.heading}>{detail && playerName(snapshot, detail.player_id)}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Close player details" onPress={() => setSelected(null)} style={styles.close}><Text style={styles.name}>Close ×</Text></Pressable></View>
          {detail && <ScrollView contentContainerStyle={styles.details}>
            <Text style={styles.text}>{detail.hand_count} cards{snapshot.players?.find(p => String(p.player_id) === detail.player_id)?.connected === false ? ' · Offline' : ''}</Text>
            <Text style={styles.text}>{detail.has_seen_maal ? 'Maal seen' : 'Maal not seen'}</Text>
            <Text style={styles.route}>{route(detail)}</Text>
            <Text style={styles.text}>{situation(detail, pub)}</Text>
            {detail.shown_melds.map((meld, i) => <View key={i} style={styles.meld}><Text style={styles.small}>{meld.meld_type.replace('_', ' ')}</Text><Text style={styles.text}>{meld.card_ids.map(physicalLabel).join('   ')}</Text></View>)}
            {mine && detail.player_id !== mine && <Pressable accessibilityRole="button" accessibilityLabel={`Poke ${playerName(snapshot, detail.player_id)}`}
              onPress={() => { setSelected(null); onPoke(Number(detail.player_id)); }} style={styles.close}><Text style={styles.name}>Poke player</Text></Pressable>}
          </ScrollView>}
        </View>
      </View>
    </Modal>
  </>;
}

export function MarriageDetails({ snapshot, section, onClose, busy, error, onSave }: { busy: boolean; error: string; onSave: (rules: import('../multiplayer/marriage').MarriageScoringRules) => void; snapshot: RoomSnapshot; section: 'stats' | 'rules' | 'points' | null; onClose: () => void }) {
  const styles = useThemedStyles(createStyles);
  const insets = useSafeAreaInsets(), pub = snapshot.marriage?.public;
  return <Modal transparent visible={section !== null} animationType="none" onRequestClose={onClose}>
    <View style={[styles.backdrop, { paddingTop: Math.max(16, insets.top), paddingBottom: Math.max(16, insets.bottom) }]}>
      <View accessibilityViewIsModal testID="marriage-details" style={styles.dialog}>
        <View style={styles.dialogHeader}><Text accessibilityRole="header" style={styles.heading}>{section === 'stats' ? 'Game stats' : section === 'rules' ? 'Marriage rules' : 'Points breakdown'}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Close details" onPress={onClose} style={styles.close}><Text style={styles.name}>Close ×</Text></Pressable></View>
        <ScrollView contentContainerStyle={styles.details}>
          {section === 'stats' ? pub ? pub.players.map(p => <View key={p.player_id} style={styles.stat}>
            <Text style={styles.name}>{playerName(snapshot, p.player_id)}</Text>
            <Text style={styles.text}>{situation(p, pub)} · {p.hand_count} cards</Text>
            <Text style={styles.text}>{p.has_seen_maal ? 'Maal seen' : 'Maal not seen'} · {route(p)}</Text>
            {p.shown_melds.map((meld, i) => <View key={i} style={styles.meld}>
              <Text style={styles.small}>{meld.meld_type === 'pure_sequence' ? 'Sequence' : meld.meld_type === 'tunnela' ? 'Tunnela' : 'Dublee'}</Text>
              <Text style={styles.text}>{meld.card_ids.map(physicalLabel).join('   ')}</Text>
            </View>)}
          </View>) : <Text style={styles.text}>Player stats appear when the game starts.</Text> : section === 'points' ? <MarriagePoints snapshot={snapshot} /> : <>
            <Text style={styles.text}>21 cards each. Take one card, optionally show melds, then discard.</Text>
            <Text style={styles.text}>Sequence: consecutive ranks in one suit, Ace low. Tunnela: three copies of one face. Dublee: two copies.</Text>
            <Text style={styles.text}>Show seven Dublees, then finish with an eighth uncommitted pair. A winning discard must be followed by Finish.</Text>
            <Text style={styles.text}>Three sequences / Tunnelas unlock Maal. Normal-hand winning is not available yet.</Text>
            <Text style={styles.text}>Other players can see your shown groups and whether you have seen Maal. Your private hand and Maal faces stay private.</Text>
            <MarriageScoring snapshot={snapshot} busy={busy} error={error} onSave={onSave} />
          </>}
        </ScrollView>
      </View>
    </View>
  </Modal>;
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center' },
  seat: { flexBasis: '45%', flexGrow: 1, minWidth: 0, minHeight: 44, padding: 8, borderRadius: 12, borderWidth: 3, borderColor: colors.maalUnseen, backgroundColor: colors.surface, justifyContent: 'center', flexDirection: 'row', alignItems: 'center', gap: 4 },
  seenSeat: { borderColor: colors.maalSeen }, active: { backgroundColor: colors.surfaceSelected }, name: { fontFamily: fonts.medium, color: colors.text, fontSize: 14 },
  small: { fontFamily: fonts.body, color: colors.textMuted, fontSize: 11, lineHeight: 16 },
  route: { fontFamily: fonts.medium, color: colors.accent, fontSize: 11, lineHeight: 15 }, seen: { color: colors.success },
  backdrop: { flex: 1, paddingHorizontal: 16, backgroundColor: colors.overlay, alignItems: 'center', justifyContent: 'center' },
  dialog: { width: '100%', maxWidth: 660, maxHeight: '90%', borderRadius: 16, backgroundColor: colors.surface, overflow: 'hidden' },
  dialogHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingLeft: 18, borderBottomWidth: 1, borderColor: colors.border },
  close: { minHeight: 44, padding: 14, justifyContent: 'center' }, heading: { fontFamily: fonts.medium, color: colors.accent, fontSize: 18 },
  details: { padding: 18, gap: 16 }, stat: { gap: 6, paddingBottom: 14, borderBottomWidth: 1, borderColor: colors.border },
  text: { fontFamily: fonts.body, color: colors.text, fontSize: 13, lineHeight: 21 }, meld: { padding: 8, backgroundColor: colors.surface, borderRadius: 8, gap: 3 },
});
