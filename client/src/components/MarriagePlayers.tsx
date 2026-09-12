import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { RoomSnapshot } from '../screens/LiveGameTable';
import type { MarriagePublic } from '../multiplayer/marriage';
import { physicalLabel } from '../multiplayer/marriage';
import { MarriageScoring, MarriagePoints } from './MarriageScoring';
import { colors, fonts } from '../theme';

type Player = MarriagePublic['players'][number];
const route = (p: Player) => p.route === 'dublee' ? '7 Dublees' : p.route === 'normal' ? '3 sequences / Tunnelas' : 'Not shown';
const situation = (p: Player, pub: MarriagePublic) => p.finished ? 'Winner' : pub.current_player_id === p.player_id
  ? pub.phase === 'must_draw' ? 'Taking a card' : 'Showing or discarding' : 'Waiting for turn';
const playerName = (snapshot: RoomSnapshot, id: string) => snapshot.players?.find(p => String(p.player_id) === id)?.display_name || `Player ${id}`;

export function MarriagePlayers({ snapshot, onPoke, registerSeat }: { snapshot: RoomSnapshot; onPoke: (seat: number) => void; registerSeat?: (seat: string, node: View | null) => void }) {
  const [width, setWidth] = useState(280);
  const pub = snapshot.marriage!.public, mine = snapshot.marriage?.private?.player_id;
  const cardWidth = Math.min(176, Math.max(1, Math.floor((width - 10) / 2)));
  return <View testID="marriage-player-grid" onLayout={e => setWidth(e.nativeEvent.layout.width)} style={styles.grid}>
    {pub.players.map(p => {
      const connected = snapshot.players?.find(row => String(row.player_id) === p.player_id)?.connected !== false;
      return <Pressable ref={node => registerSeat?.(p.player_id, node)} key={p.player_id} testID={`marriage-player-${p.player_id}`} accessibilityRole="button"
        accessibilityLabel={`Poke ${playerName(snapshot, p.player_id)}`} disabled={!mine || p.player_id === mine}
        onPress={() => onPoke(Number(p.player_id))} style={[styles.seat, { width: cardWidth, height: 140 }, pub.current_player_id === p.player_id && styles.active]}>
        <Text numberOfLines={1} style={styles.name}>{playerName(snapshot, p.player_id)}{p.player_id === mine ? ' · You' : ''}</Text>
        <Text style={styles.small}>{p.hand_count} cards{connected ? '' : ' · Offline'}</Text>
        <Text style={[styles.small, p.has_seen_maal && styles.seen]}>{p.has_seen_maal ? 'Maal seen' : 'Maal not seen'}</Text>
        <Text style={styles.route}>{route(p)}</Text>
        <Text style={styles.small}>{situation(p, pub)}</Text>
      </Pressable>;
    })}
  </View>;
}

export function MarriageDetails({ snapshot, section, onClose, busy, error, onSave }: { busy: boolean; error: string; onSave: (rules: import('../multiplayer/marriage').MarriageScoringRules) => void; snapshot: RoomSnapshot; section: 'stats' | 'rules' | 'points' | null; onClose: () => void }) {
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

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'center' },
  seat: { padding: 8, borderRadius: 12, borderWidth: 1, borderColor: '#537E68', backgroundColor: '#173D38', gap: 3 },
  active: { borderColor: '#76EEA3', borderWidth: 2 }, name: { fontFamily: fonts.medium, color: colors.ivory, fontSize: 14 },
  small: { fontFamily: fonts.body, color: '#BBC9D6', fontSize: 11, lineHeight: 16 },
  route: { fontFamily: fonts.medium, color: colors.champagne, fontSize: 11, lineHeight: 15 }, seen: { color: '#76EEA3' },
  backdrop: { flex: 1, paddingHorizontal: 16, backgroundColor: '#020A14DD', alignItems: 'center', justifyContent: 'center' },
  dialog: { width: '100%', maxWidth: 660, maxHeight: '90%', borderRadius: 16, backgroundColor: '#173046', overflow: 'hidden' },
  dialogHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingLeft: 18, borderBottomWidth: 1, borderColor: '#FFFFFF22' },
  close: { minHeight: 44, padding: 14, justifyContent: 'center' }, heading: { fontFamily: fonts.medium, color: colors.champagne, fontSize: 18 },
  details: { padding: 18, gap: 16 }, stat: { gap: 6, paddingBottom: 14, borderBottomWidth: 1, borderColor: '#FFFFFF22' },
  text: { fontFamily: fonts.body, color: colors.ivory, fontSize: 13, lineHeight: 21 }, meld: { padding: 8, backgroundColor: '#234535', borderRadius: 8, gap: 3 },
});
