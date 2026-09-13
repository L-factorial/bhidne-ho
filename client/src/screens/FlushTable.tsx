import { AppHeader } from '../components/AppHeader';
import { type ReactNode, useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { fonts, useThemedStyles, type ThemeColors } from '../theme';
import type { RoomSnapshot } from './LiveGameTable';
import { FlushFoldNotice } from '../components/FlushFoldNotice';
import { FlushLockButton } from '../components/FlushLockButton';
import { FlushArena } from '../components/FlushArena';
import { FlushCards } from '../components/FlushCards';
import { FlushBetTable } from '../components/FlushBetTable';
import { TurnPulse } from '../components/TurnPulse';
import { PokeComposer } from '../components/PokeComposer';
import type { PlayerPhrase } from '../multiplayer/pokes';
import type { FlushRules } from '../multiplayer/flush';

const labels: Record<keyof FlushRules, string> = {
  allow_side_show: 'Allow private side-show',
  boot_amount: 'Boot per player (0 disables)', initial_blind_bet: 'Blind bet',
  minimum_bet_rounds_before_side_show: 'Personal bets before side-show', blind_to_seen_bet_multiplier: 'Seen bet multiplier',
  minimum_blind_rounds_before_show: 'Personal blind bets before show', maximum_active_players_for_blind_show: 'Blind show: at most N active players',
  allow_blind_show: 'Allow blind show', allow_seen_show: 'Allow seen show', show_only_when_two_players_remain: 'Show only with two players',
  minimum_players: 'Minimum players', maximum_players: 'Maximum players', show_cost_multiplier: 'Show cost multiplier (0 is free)',
  sequence_ace_policy: 'Ace sequence order', tie_policy: 'Equal hands',
};
const choices = {
  sequence_ace_policy: [['akq_first_a23_second', 'AKQ first, A23 second'], ['a23_first', 'A23 first'], ['a23_lowest', 'A23 lowest']],
  tie_policy: [['requester_loses', 'Show requester loses'], ['split', 'Split pot']],
};

export function FlushTable({ snapshot, busy, error, onSave, onStart, onAction, onBack, onNewGame, endControl, lobbyControl, social }: {
  social: { connected: boolean; phrases: PlayerPhrase[]; save: (text: string) => Promise<void>; send: (text: string) => Promise<void> };
  snapshot: RoomSnapshot; busy: boolean; error: string; endControl?: ReactNode; lobbyControl?: ReactNode;
  onSave: (payload: { rules: FlushRules; starting_chips: number; rules_revision: number }) => void;
  onStart: (revision: number) => void; onAction: (command: string, payload?: object) => void;
  onBack: () => void; onNewGame: () => void;
}) {
  const s = useThemedStyles(styles);
  const settings = snapshot.flush_settings!;
  const [rulesOpen, setRulesOpen] = useState(false);
  const [betsOpen, setBetsOpen] = useState(false);
  const [pokeOpen, setPokeOpen] = useState(false);
  const [arenaHeight, setArenaHeight] = useState(280);
  const [draft, setDraft] = useState<Record<string, string | number | boolean>>({ ...settings.rules, starting_chips: settings.starting_chips });
  const [baseRevision, setBaseRevision] = useState(settings.rules_revision);
  const [dirty, setDirty] = useState(false);
  const [localError, setLocalError] = useState('');
  const stale = baseRevision !== settings.rules_revision;
  function reload() { setDraft({ ...settings.rules, starting_chips: settings.starting_chips }); setBaseRevision(settings.rules_revision); setDirty(false); setLocalError(''); }
  useEffect(() => {
    const saved = { ...settings.rules, starting_chips: settings.starting_chips };
    if (!dirty || Object.entries(saved).every(([key, value]) => String(draft[key]) === String(value))) reload();
  }, [settings.rules_revision]);
  const editable = snapshot.is_creator && !settings.locked && !busy;
  const shownRules = settings.locked ? { ...settings.rules, starting_chips: settings.starting_chips } : draft;
  function edit(key: string, value: string | boolean) { setDraft(v => ({ ...v, [key]: value })); setDirty(true); setLocalError(''); }
  function save() {
    const values: Record<string, string | number | boolean> = { ...draft };
    for (const key of [...Object.keys(settings.rules).filter(k => typeof settings.rules[k as keyof FlushRules] === 'number'), 'starting_chips']) {
      if (!/^\d+$/.test(String(values[key])) || !Number.isSafeInteger(Number(values[key]))) { setLocalError('Enter whole, nonnegative chip amounts and counts.'); return; }
      values[key] = Number(values[key]);
    }
    onSave({ rules: Object.fromEntries(Object.entries(values).filter(([k]) => k !== 'starting_chips')) as FlushRules,
      starting_chips: Number(values.starting_chips), rules_revision: baseRevision });
    // Keep drafts on rejection. A successful save publishes a new rules revision.
  }
  const pub = snapshot.flush?.public, mine = snapshot.flush?.private;
  const [finalShowOpen, setFinalShowOpen] = useState(false);
  const finalStage = pub?.pending_show ? 'pending' : pub?.settlement ? 'result' : null;
  useEffect(() => { setFinalShowOpen(finalStage !== null); }, [snapshot.match_id, pub?.round_number, finalStage]);
  const comparison = mine?.side_show;
  const preparing = pub?.status === 'awaiting_deal' || pub?.status === 'awaiting_cut';
  const myTurn = !!pub?.current_player_id && pub.current_player_id === String(snapshot.your_player_id);
  const doubleBet = (mine?.actions.required_bet ?? 0) * 2;
  const chips = pub?.players.find(p => p.player_id === String(snapshot.your_player_id))?.chips ?? 0;
  const canDouble = Number.isSafeInteger(doubleBet) && doubleBet > 0 && doubleBet <= chips;
  const ackKey = `bhidne.flush-side-show:${snapshot.match_id}:${snapshot.your_player_id}`;
  const [acknowledged, setAcknowledged] = useState(() => { try { return Number(globalThis.sessionStorage?.getItem(ackKey) || 0); } catch { return 0; } });
  const [flippedAll, setFlippedAll] = useState(false);
  const [resultOpen, setResultOpen] = useState(false);
  const comparisonOpen = !!comparison && comparison.revision > acknowledged;
  useEffect(() => { setFlippedAll(false); setResultOpen(false); }, [comparison?.revision]);
  useEffect(() => { if (!flippedAll) return; const timer = setTimeout(() => setResultOpen(true), 400); return () => clearTimeout(timer); }, [flippedAll]);
  function acknowledge() {
    if (!comparison) return;
    setAcknowledged(comparison.revision); setResultOpen(false);
    try { globalThis.sessionStorage?.setItem(ackKey, String(comparison.revision)); } catch { /* Local fallback. */ }
  }

  const name = (id: string) => snapshot.players?.find(p => String(p.player_id) === id)?.display_name || `Player ${id}`;
  const can = (kind: string) => !busy && snapshot.status === 'playing' && !!mine?.actions.kinds.includes(kind);
  const button = (label: string, action: () => void, disabled = false) => <Pressable accessibilityRole="button" accessibilityLabel={label}
    disabled={disabled} accessibilityState={{ disabled }} onPress={action} style={[s.button, disabled && { opacity: 0.45 }]}><Text style={s.text}>{label}</Text></Pressable>;
  return <View style={s.page} testID="flush-table">
    <AppHeader title="Flush" actions={<>{endControl}{button('Collapse table', onBack)}</>} />
    <View style={s.tabs}>{button('Bet', () => setBetsOpen(true))}{button('Rules', () => setRulesOpen(true))}{!!snapshot.your_player_id && button('Poke the table', () => setPokeOpen(true), !social.connected)}</View>
    {!!pub?.current_player_id && <TurnPulse personal={myTurn} text={myTurn
      ? `Your turn · ${pub.pending_show ? 'Reveal or fold' : pub.pending_side_show ? 'Accept or decline side-show' : pub.status === 'awaiting_deal' ? 'Deal cards' : pub.status === 'awaiting_cut' ? 'Cut or skip' : 'Bet, show, or fold'}`
      : `${name(pub.current_player_id)}’s turn`} />}
    <ScrollView onLayout={e => setArenaHeight(Math.max(220, Math.min(370, e.nativeEvent.layout.height - 36)))} contentContainerStyle={s.playArea}>
      {finalStage && button(finalStage === 'pending' ? 'View final show' : 'View round result', () => setFinalShowOpen(true))}
    {(snapshot.status === 'waiting' || snapshot.roster_open) && <View style={s.panel}>
      <Text style={s.title}>{snapshot.players?.length}/{snapshot.capacity} players seated · minimum 2</Text>
      <Text style={s.text}>Locking keeps the current players for the next round. Seating reopens when that round ends.</Text>
      {snapshot.players?.map(p => <Text key={p.player_id} style={s.text}>{p.display_name}</Text>)}
      {snapshot.is_creator ? <FlushLockButton onPress={() => onStart(baseRevision)} disabled={busy || !snapshot.ready || dirty || stale} /> : <Text style={s.text}>Waiting for the creator to lock the table.</Text>}{lobbyControl}
    </View>}
    {pub && <>
      <FlushFoldNotice key={`folds:${snapshot.match_id}`} snapshot={snapshot} />
      <FlushArena key={`${snapshot.match_id}:${pub.round_number}`} snapshot={snapshot} height={pub.players.length > 5 ? 370 + (pub.players.length - 5) * 126 : arenaHeight} />
      {preparing && <View style={s.panel}>
        <Text style={s.text}>{pub.status === 'awaiting_deal' ? `${name(pub.current_player_id!)} deals next.` : `${name(pub.current_player_id!)} can cut the deck or skip the cut.`}</Text>
        {can('deal_cards') && button('Deal cards', () => onAction('DEAL_CARDS'), busy)}
        {can('cut_deck') && <View style={s.row}>{button('Cut in half', () => onAction('CUT_DECK', { position: 26 }), busy)}{button('Skip cut', () => onAction('SKIP_CUT'), busy)}</View>}
      </View>}
      {pub.pending_side_show && <View style={s.panel}>
        <Text style={s.text}>{name(pub.pending_side_show.requester_id)} requests a side-show with {name(pub.pending_side_show.target_id)}.</Text>
        {can('accept_side_show') ? <View style={s.row}>{button('Accept side-show', () => onAction('ACCEPT_SIDE_SHOW'), busy)}{button('Decline side-show', () => onAction('DECLINE_SIDE_SHOW'), busy)}</View>
          : <Text style={s.text}>Waiting for a response. Other turns are paused.</Text>}
      </View>}

    </>}
    {!!(localError || error) && <Text accessibilityRole="alert" style={s.error}>{localError || error}</Text>}
    </ScrollView>
    {mine && !preparing && !pub?.settlement && <View style={s.handDock} testID="flush-hand-dock">
      <View style={s.row}><Text style={s.title}>Your cards</Text></View>
      {!!mine.cards.length && !comparisonOpen && <Text style={s.text}>Tap the cards to see all three · tap again to hide.</Text>}
      {comparisonOpen && comparison ? <View testID="flush-private-comparison">
        <Text style={s.text}>Private side-show · flip {name(comparison.opponent_id)}’s cards</Text>
        <FlushCards key={`side-${comparison.revision}`} cards={comparison.opponent_cards} label="Opponent card" onComplete={() => setFlippedAll(true)} />
      </View> : <FlushCards tapToToggle key={pub?.round_number} cards={mine.cards} />}
      {pub?.status === 'in_progress' && !pub.pending_show && !comparisonOpen && <View style={s.row}>
        {button(`Bet minimum · ${mine.actions.required_bet} chips`, () => onAction('BET', { amount: mine.actions.required_bet }), !can('bet'))}
        {button(`Bet double · ${doubleBet} chips`, () => onAction('BET', { amount: doubleBet }), !can('bet') || !canDouble)}
        {button('See cards', () => onAction('SEE_CARDS'), !can('see_cards'))}
        {button('Fold', () => onAction('FOLD'), !can('fold'))}
        {button(`Show · ${mine.actions.show_cost} chips`, () => onAction('SHOW'), !can('show'))}
        {settings.rules.allow_side_show && button('Request side-show', () => onAction('REQUEST_SIDE_SHOW'), !can('request_side_show'))}
      </View>}
    </View>}
    {pokeOpen && <PokeComposer recipient={null} connected={social.connected} phrases={social.phrases} onSave={social.save}
      onSend={social.send} onClose={() => setPokeOpen(false)} />}
    <Modal transparent visible={rulesOpen} onRequestClose={() => setRulesOpen(false)}>
      <View style={s.backdrop}><View style={s.modal} accessibilityViewIsModal><View style={s.row}><Text style={s.title}>Rules</Text>{button('Close Flush rules', () => setRulesOpen(false))}</View>
      <ScrollView testID="flush-rules" contentContainerStyle={{ gap: 12 }}>
      <Text style={s.title}>{settings.locked ? 'Rules locked for this game' : 'Rules before starting'}</Text>
      <Text style={s.text}>You can see your cards on your turn without prior bets. Side-show requires the configured number of completed personal bets (blind or seen), excluding boot. Bet the minimum or double your current blind or seen minimum to raise. Blind bets set the seen minimum using the multiplier; seen bets set the blind minimum by dividing and rounding up. Show always requires exactly two active players. A side-show request costs one seen bet, even if declined; only the two participants can see the compared cards.</Text>
      {stale && dirty && !settings.locked && <Text accessibilityRole="alert" style={s.error}>Saved rules changed. Reload before editing or starting.</Text>}
      {(['starting_chips', ...Object.keys(labels)] as (keyof FlushRules | 'starting_chips')[]).map(key => {
        const value = shownRules[key]; const label = key === 'starting_chips' ? 'Starting chips per player' : labels[key];
        return <View key={key} style={s.field}><Text style={s.text}>{label}</Text>
          {typeof value === 'boolean' ? button(value ? `${label}: Yes` : `${label}: No`, () => edit(key, !value), !editable || key === 'show_only_when_two_players_remain')
            : key === 'sequence_ace_policy' || key === 'tie_policy' ? <View style={s.row}>{choices[key].map(([v, title]) => <Pressable key={v} accessibilityRole="radio" accessibilityLabel={title}
              accessibilityState={{ checked: value === v, disabled: !editable }} disabled={!editable} onPress={() => edit(key, v)} style={[s.button, value === v && s.chosen]}><Text style={s.text}>{title}</Text></Pressable>)}</View>
            : <TextInput accessibilityLabel={label} value={String(value)} editable={!!editable && key !== 'minimum_players' && key !== 'maximum_players'} keyboardType="number-pad" onChangeText={v => edit(key, v)} style={s.input} />}
        </View>;
      })}
      {!settings.locked && snapshot.is_creator && <View style={s.row}>{button('Save Flush rules', save, busy || !dirty || stale)}{button('Reload saved rules', reload, busy)}</View>}
      <Text style={s.text}>{settings.locked ? 'New rules can be chosen for the next game.' : dirty ? 'Save and review the saved rules before starting.' : 'Everyone can review these saved rules. They lock when the creator starts.'}</Text>

      {!!(localError || error) && <Text accessibilityRole="alert" style={s.error}>{localError || error}</Text>}
      </ScrollView></View></View>
    </Modal>
    <Modal transparent visible={finalShowOpen && finalStage !== null} animationType="fade" onRequestClose={() => setFinalShowOpen(false)}>
      <View style={s.backdrop}><View style={s.modal} accessibilityViewIsModal testID="flush-show-overlay">
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text accessibilityRole="header" style={s.title}>{finalStage === 'pending' ? 'Final show' : 'Round result'}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Close final show" onPress={() => setFinalShowOpen(false)}
            style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}><Text style={[s.text, { fontSize: 26 }]}>×</Text></Pressable>
        </View>
        <ScrollView contentContainerStyle={{ gap: 12 }}>
      {pub?.pending_show && <View style={s.panel} testID="flush-final-show">
        <Text style={s.title}>{name(pub.pending_show.requester_id)} shows</Text>
        {pub.revealed_hands.map(hand => <FlushCards autoReveal key={`${pub.round_number}:${hand.player_id}`} label={`${name(hand.player_id)} shown card`}
          cards={hand.cards.map(c => `${({11:'J',12:'Q',13:'K',14:'A'} as Record<number,string>)[c.rank] || c.rank}${c.suit}`)} />)}
        <Text style={s.text}>{name(pub.pending_show.target_id)} can fold or reveal their cards.</Text>
        {can('reveal_cards') && <View style={s.row}>{button('Reveal cards', () => onAction('REVEAL_CARDS'), busy)}{button('Fold', () => onAction('FOLD'), busy)}</View>}
      </View>}
      {pub?.settlement && <View style={s.panel} testID="flush-round-result"><Text style={s.title}>Winner: {pub.settlement.winner_ids.map(name).join(', ')}</Text>
        {pub.settlement.payouts.map(p => <Text key={p.player_id} style={s.text}>{name(p.player_id)} receives {p.amount} chips</Text>)}
        {pub.settlement.shown_hands.map(p => <View key={p.player_id}><Text style={s.text}>{name(p.player_id)}’s shown hand</Text><FlushCards autoReveal key={`${pub.round_number}:${p.player_id}`} label={`${name(p.player_id)} card`} cards={p.cards.map(c => `${({11:'J',12:'Q',13:'K',14:'A'} as Record<number,string>)[c.rank] || c.rank}${c.suit}`)} /></View>)}
        <Text style={s.text}>Players may join or leave now. The creator must lock the table before the next deal.</Text>
        </View>}
          {!!error && <Text accessibilityRole="alert" style={s.error}>{error}</Text>}
        </ScrollView>
      </View></View>
    </Modal>
    <Modal transparent visible={betsOpen} onRequestClose={() => setBetsOpen(false)}>
      <View style={s.backdrop}><View style={s.modal} accessibilityViewIsModal><View style={s.row}><Text style={s.title}>Bet history</Text>{button('Close Bet', () => setBetsOpen(false))}</View>
        <FlushBetTable snapshot={snapshot} />
      </View></View>
    </Modal>
    <Modal transparent visible={resultOpen && comparisonOpen} onRequestClose={acknowledge}>
      <View style={s.backdrop}><View style={s.modal} accessibilityViewIsModal><Text accessibilityRole="alert" style={s.title}>{comparison?.won ? 'You stay' : 'You lost'}</Text>{button('Continue', acknowledge)}</View></View>
    </Modal>
  </View>;
}

const styles = (c: ThemeColors) => StyleSheet.create({
  page: { flex: 1, padding: 12, gap: 8, backgroundColor: c.background },
  tabs: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  playArea: { flexGrow: 1, gap: 8, paddingBottom: 8 },
  handDock: { borderTopWidth: 1, borderColor: c.border, paddingTop: 8, gap: 4 },
  backdrop: { flex: 1, backgroundColor: c.overlay, alignItems: 'center', justifyContent: 'center', padding: 16 },
  modal: { backgroundColor: c.surface, padding: 16, borderRadius: 14, width: '100%', maxWidth: 720, maxHeight: '90%', gap: 12 },
  panel: { backgroundColor: c.surface, padding: 16, borderRadius: 14, gap: 12 },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  title: { color: c.text, fontFamily: fonts.medium, fontSize: 20 }, text: { color: c.text, fontFamily: fonts.body, fontSize: 14 },
  button: { padding: 12, borderRadius: 8, backgroundColor: c.surfaceRaised, borderWidth: 1, borderColor: c.border },
  chosen: { borderColor: c.accent, backgroundColor: c.surfaceSelected },
  field: { gap: 6 }, input: { padding: 12, borderRadius: 8, borderWidth: 1, borderColor: c.border, color: c.text },
  error: { color: c.danger, fontFamily: fonts.body },
});
