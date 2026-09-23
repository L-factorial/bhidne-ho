import { Ionicons } from '@expo/vector-icons';
import { MarriageMeldCards } from './MarriageMeldCards';
import { RoomSheet } from './RoomSheet';
import { PlayerSeat } from './PlayerSeat';
import { TableSeatLayout } from './TableSeatLayout';
import { useState, type ReactNode } from 'react';
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

export function MarriagePlayers({ snapshot, onPoke, registerSeat, children }: { children?: ReactNode; snapshot: RoomSnapshot; onPoke?: (seat: number) => void; registerSeat?: (seat: string, node: View | null) => void }) {
  const styles = useThemedStyles(createStyles);
  const [shownPlayer, setShownPlayer] = useState<{ match: string; id: string } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const insets = useSafeAreaInsets();
  const pub = snapshot.marriage!.public, mine = snapshot.marriage?.private?.player_id;
  const detail = pub.players.find(p => p.player_id === selected);
  const shown = shownPlayer && shownPlayer.match === (snapshot.match_id || '') ? pub.players.find(p => p.player_id === shownPlayer.id && p.has_seen_maal) : undefined;
  return <>
    <TableSeatLayout game="marriage" fill testID="marriage-player-grid" players={pub.players.map(player => ({ ...player, id: player.player_id }))} viewerId={mine || ''}
      renderSeat={p => <View style={styles.seat}><PlayerSeat playerId={Number(p.player_id)} name={playerName(snapshot, p.player_id)} mine={p.player_id === mine}
        active={snapshot.status === 'playing' && pub.current_player_id === p.player_id}
        status={`${p.hand_count} cards`} connected={snapshot.players?.find(row => String(row.player_id) === p.player_id)?.connected}
        avatarUrl={snapshot.players?.find(row => String(row.player_id) === p.player_id)?.avatar_url}
        registerSeat={node => registerSeat?.(p.player_id, node)} testID={`marriage-player-${p.player_id}`} onPress={() => setSelected(p.player_id)} />
        {p.has_seen_maal && <Pressable testID={`marriage-maal-check-${p.player_id}`} accessibilityRole="button"
          accessibilityLabel={`View ${playerName(snapshot, p.player_id)}’s shown cards`}
          accessibilityHint="Maal unlocked. Opens this player's declared sequences or Dublees."
          onPress={() => setShownPlayer({ match: snapshot.match_id || '', id: p.player_id })} style={styles.maalCheck}>
          <View style={styles.maalCheckCircle}><Ionicons name="checkmark" size={18} color="#FFFFFF" /></View>
        </Pressable>}
      </View>}>
      {children}
    </TableSeatLayout>
    <RoomSheet visible={!!shown} title={shown ? `${playerName(snapshot, shown.player_id)}’s shown cards` : 'Shown cards'}
      onClose={() => setShownPlayer(null)} presentation="dialog" testID="marriage-shown-cards" closeLabel="Close shown cards">
      {shown && <>
        <Text style={styles.seen}>✓ Maal unlocked · {route(shown)}</Text>
        <MarriageMeldCards groups={shown.shown_melds} />
      </>}
    </RoomSheet>
    <Modal transparent visible={!!detail} animationType="none" onRequestClose={() => setSelected(null)}>
      <View style={[styles.backdrop, { paddingTop: Math.max(16, insets.top), paddingBottom: Math.max(16, insets.bottom) }]}>
        <View accessibilityViewIsModal testID="marriage-player-details" style={styles.dialog}>
          <View style={styles.dialogHeader}><Text accessibilityRole="header" style={styles.heading}>{detail && playerName(snapshot, detail.player_id)}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Close player details" onPress={() => setSelected(null)} style={styles.close}><Text style={styles.name}>Close ×</Text></Pressable></View>
          {detail && <ScrollView contentContainerStyle={styles.details}>
            <Text style={styles.text}>{detail.hand_count} cards{snapshot.players?.find(p => String(p.player_id) === detail.player_id)?.connected === false ? ' · Offline' : ''}</Text>
            <Text style={styles.text}>{detail.has_seen_maal ? 'Maal seen' : 'Maal not seen'}</Text>
            <Text style={styles.route}>{route(detail)}</Text>
            <Text style={styles.text}>{snapshot.status === 'ended' ? 'Table ended' : situation(detail, pub)}</Text>
            {detail.shown_melds.map((meld, i) => <View key={i} style={styles.meld}><Text style={styles.small}>{meld.meld_type.replace('_', ' ')}</Text><Text style={styles.text}>{meld.card_ids.map(physicalLabel).join('   ')}</Text></View>)}
            {onPoke && mine && detail.player_id !== mine && <Pressable accessibilityRole="button" accessibilityLabel={`Poke ${playerName(snapshot, detail.player_id)}`}
              onPress={() => { setSelected(null); onPoke(Number(detail.player_id)); }} style={styles.close}><Text style={styles.name}>Poke player</Text></Pressable>}
          </ScrollView>}
        </View>
      </View>
    </Modal>
  </>;
}

export function MarriageDetails({ snapshot, section, onClose, busy, error, onSave }: { busy: boolean; error: string; onSave: (rules: import('../multiplayer/marriage').MarriageScoringRules) => void; snapshot: RoomSnapshot; section: 'stats' | 'rules' | 'points' | null; onClose: () => void }) {
  const styles = useThemedStyles(createStyles);
  const pub = snapshot.marriage?.public;
  return <RoomSheet visible={section !== null} title={section === 'stats' ? 'Game stats' : section === 'rules' ? 'Marriage rules' : 'Game result'} onClose={onClose} closeLabel="Close details" testID="marriage-details" scrollable={false} contentHandlesBottomInset={section === 'rules'}>
        {section === 'rules' ? <MarriageScoring snapshot={snapshot} busy={busy} error={error} onSave={onSave} introduction={<>
            <Text style={styles.text}>21 cards each. Take one card, optionally show melds, then discard.</Text>
            <Text style={styles.text}>Sequence: consecutive ranks in one suit, Ace low. Tunnela: three copies of one face. Dublee: two copies.</Text>
            <Text style={styles.text}>Show seven Dublees, then finish with an eighth uncommitted pair. A winning discard must be followed by Finish.</Text>
            <Text style={styles.text}>Normal route: three natural sequences / Tunnelas unlock Maal and stay fixed. Complete 21 cards in melds and discard the remaining card to finish.</Text>
            <Text style={styles.text}>After qualification, Man, every Tiplu-rank card, and Jhiplu / Poplu are wildcards. Final sequences have 3 or more cards, Ace low; sets have 3 or 4 cards of one rank in distinct suits. Three natural copies of one face also form a Tunnela. All-wild groups are allowed.</Text>
            <Text style={styles.text}>Other players see your shown groups and completed winning hand. Your hand stays private during play, and Maal faces are shown only to qualified players.</Text>
</>} /> : <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.details}>
          {section === 'stats' ? pub ? pub.players.map(p => <View key={p.player_id} style={styles.stat}>
            <Text style={styles.name}>{playerName(snapshot, p.player_id)}</Text>
            <Text style={styles.text}>{situation(p, pub)} · {p.hand_count} cards</Text>
            <Text style={styles.text}>{p.has_seen_maal ? 'Maal seen' : 'Maal not seen'} · {route(p)}</Text>
            {p.shown_melds.map((meld, i) => <View key={i} style={styles.meld}>
              <Text style={styles.small}>{meld.meld_type === 'pure_sequence' ? 'Sequence' : meld.meld_type === 'tunnela' ? 'Tunnela' : 'Dublee'}</Text>
              <Text style={styles.text}>{meld.card_ids.map(physicalLabel).join('   ')}</Text>
            </View>)}
          </View>) : <Text style={styles.text}>Player stats appear when the game starts.</Text> : section === 'points' ? <MarriagePoints snapshot={snapshot} /> : null}
        </ScrollView>}
  </RoomSheet>;
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  seat: { width: '100%', position: 'relative' },
  maalCheck: { position: 'absolute', top: -8, right: -6, width: 44, height: 44, alignItems: 'center', justifyContent: 'center', zIndex: 2 },
  maalCheckCircle: { width: 26, height: 26, borderRadius: 13, backgroundColor: '#167A46', borderWidth: 2, borderColor: colors.table, alignItems: 'center', justifyContent: 'center' },
  name: { fontFamily: fonts.medium, color: colors.text, fontSize: 14 },
  small: { fontFamily: fonts.body, color: colors.textMuted, fontSize: 11, lineHeight: 16 },
  route: { fontFamily: fonts.medium, color: colors.accent, fontSize: 11, lineHeight: 15 }, seen: { color: colors.success },
  backdrop: { flex: 1, paddingHorizontal: 16, backgroundColor: colors.overlay, alignItems: 'center', justifyContent: 'center' },
  dialog: { width: '100%', maxWidth: 660, maxHeight: '90%', borderRadius: 16, backgroundColor: colors.surface, overflow: 'hidden' },
  dialogHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingLeft: 18, borderBottomWidth: 1, borderColor: colors.border },
  close: { minHeight: 44, padding: 14, justifyContent: 'center' }, heading: { fontFamily: fonts.medium, color: colors.accent, fontSize: 18 },
  details: { padding: 18, gap: 16 }, stat: { gap: 6, paddingBottom: 14, borderBottomWidth: 1, borderColor: colors.border },
  text: { fontFamily: fonts.body, color: colors.text, fontSize: 13, lineHeight: 21 }, meld: { padding: 8, backgroundColor: colors.surface, borderRadius: 8, gap: 3 },
});
