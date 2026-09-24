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
const situation = (p: Player, pub: MarriagePublic) => p.folded ? 'Folded' : p.finished ? 'Winner' : pub.current_player_id === p.player_id
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
        status={p.folded ? 'Folded' : `${p.hand_count} cards`} connected={snapshot.players?.find(row => String(row.player_id) === p.player_id)?.connected}
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
  return <RoomSheet visible={section !== null} title={section === 'stats' ? 'Game stats' : section === 'rules' ? 'Rules and config' : 'Game result'} onClose={onClose} closeLabel="Close details" testID="marriage-details" scrollable={false} contentHandlesBottomInset={section === 'rules'}>
        {section === 'rules' ? <MarriageRulesAndConfig snapshot={snapshot} busy={busy} error={error} onSave={onSave} /> : <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.details}>
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

function MarriageRulesAndConfig(props: React.ComponentProps<typeof MarriageScoring>) {
  const [tab, setTab] = useState<'rules' | 'config'>('config');
  const styles = useThemedStyles(createStyles);
  return <View style={{flex:1,minHeight:0}}>
    <View accessibilityRole="tablist" style={{flexDirection:'row',padding:12,gap:8}}>
      {(['rules','config'] as const).map(value => <Pressable key={value} accessibilityRole="tab"
        accessibilityLabel={value === 'rules' ? 'Rules' : 'Config'} accessibilityState={{selected:tab === value}}
        onPress={() => setTab(value)} style={[styles.tab,tab === value && styles.tabSelected]}>
        <Text style={styles.name}>{value === 'rules' ? 'Rules' : 'Config'}</Text>
      </Pressable>)}
    </View>
    <View style={{flex:1,minHeight:0,display:tab === 'config' ? 'flex' : 'none'}} accessibilityElementsHidden={tab !== 'config'} importantForAccessibility={tab === 'config' ? 'auto' : 'no-hide-descendants'}>
      <MarriageScoring {...props}/>
    </View>
    {tab === 'rules' && <ScrollView testID="marriage-static-rules" contentContainerStyle={styles.details}>
      {[
        ['Deal and turns', 'Each player receives 21 cards. On your turn, draw from the deck or an allowed discard, then discard one card.'],
        ['Initial Tunnelas', 'Enabled by default: before the first draw, everyone shows selected dealt Tunnelas or declares none. Declared cards stay in your hand and cannot be discarded. This does not unlock Maal. The rule can be disabled in Config.'],
        ['Natural groups', 'A sequence has at least three consecutive cards of one suit. A-2-3 and Q-K-A are valid; K-A-2 is not. A Tunnela is three physical copies of the same rank and suit. A Dublee is two copies.'],
        ['Seeing Maal', 'Show three disjoint natural sequences or Tunnelas, or seven disjoint Dublees. These shown groups stay fixed. Wildcards cannot replace natural cards in this qualification.'],
        ['Tiplu, Jhiplu, Poplu and Alter', 'Tiplu is the revealed indicator. Jhiplu is the previous rank in the same suit; Poplu is the next. With A♥ as Tiplu, these are K♥ and 2♥. Alter is the same-rank card in the other suit of the same colour: A♦ in this example. Points follow Config.'],
        ['Winning after Maal', 'On the normal route, after drawing, arrange 21 cards into valid groups including your three fixed groups, and discard the remaining card. Final groups can include sequences, Tunnelas, or sets of 3–4 same-rank cards in different suits. Man, all Tiplu-rank cards, and same-suit Jhiplu/Poplu can act as wildcards. All-wild groups are allowed.'],
        ['Dublee finish', 'After showing seven Dublees, finish with an eighth natural pair using uncommitted cards. A permitted winning discard must be followed by Finish.'],
        ['Points and privacy', 'Scoring values, Maal eligibility and bonuses follow the approved configuration. Other players see your declarations and completed winning hand; your remaining cards stay private. Only qualified players can see Maal.'],
        ['Folding', 'Folding withdraws you from the round. If only one player remains, they win by fold; points still settle under the configured rules.'],
      ].map(([title,body]) => <View key={title} style={{gap:6}}><Text accessibilityRole="header" style={styles.heading}>{title}</Text><Text style={styles.text}>{body}</Text></View>)}
    </ScrollView>}
  </View>;
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  tab: { flex:1,minHeight:44,alignItems:'center',justifyContent:'center',borderRadius:10,borderWidth:1,borderColor:colors.border },
  tabSelected: { backgroundColor:colors.surfaceSelected,borderColor:colors.accent },
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
