import { GameTableHeader } from '../components/GameTableHeader';
import { ActionCue } from '../components/ActionCue';
import { type ReactNode, useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { fonts, useThemedStyles, type ThemeColors } from '../theme';
import type { RoomSnapshot } from './LiveGameTable';
import { FlushFoldNotice } from '../components/FlushFoldNotice';
import { FlushLockButton } from '../components/FlushLockButton';
import { FlushArena } from '../components/FlushArena';
import { FlushCards } from '../components/FlushCards';
import { FlushBetTable } from '../components/FlushBetTable';
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

export function FlushTable({ snapshot, busy, error, onSave, onStart, onLock, onAction, onBack, onNewGame, endControl, lobbyControl, social, onFormationBlocked, tableControl }: {
  tableControl?: ReactNode;
  onLock: () => void;
  onFormationBlocked?: (blocked: boolean) => void;
  social: { connected: boolean; phrases: PlayerPhrase[]; save: (text: string) => Promise<void>; send: (text: string) => Promise<void> };
  snapshot: RoomSnapshot; busy: boolean; error: string; endControl?: ReactNode; lobbyControl?: ReactNode;
  onSave: (payload: { rules: FlushRules; rules_revision: number }) => void;
  onStart: (revision: number) => void; onAction: (command: string, payload?: object) => void;
  onBack: () => void; onNewGame: () => void;
}) {
  const s = useThemedStyles(styles);
  const width = useWindowDimensions().width;
  const mobile = width < 900;
  const act = onAction;
  const settings = snapshot.flush_settings!;
  const [rulesOpen, setRulesOpen] = useState(false);
  const [betsOpen, setBetsOpen] = useState(false);
  const [pokeOpen, setPokeOpen] = useState(false);
  const [arenaHeight, setArenaHeight] = useState(280);
  const [draft, setDraft] = useState<Record<string, string | number | boolean>>({ ...settings.rules });
  const [baseRevision, setBaseRevision] = useState(settings.rules_revision);
  const [dirty, setDirty] = useState(false);
  const [localError, setLocalError] = useState('');
  const stale = baseRevision !== settings.rules_revision;
  useEffect(() => { onFormationBlocked?.(dirty || stale); }, [dirty, stale, onFormationBlocked]);
  useEffect(() => () => onFormationBlocked?.(false), [onFormationBlocked]);
  function reload() { setDraft({ ...settings.rules }); setBaseRevision(settings.rules_revision); setDirty(false); setLocalError(''); }
  useEffect(() => {
    const saved = { ...settings.rules };
    if (!dirty || Object.entries(saved).every(([key, value]) => String(draft[key]) === String(value))) reload();
  }, [settings.rules_revision]);
  const editable = snapshot.is_creator && !settings.locked && !busy && snapshot.rule_proposal?.status !== 'PENDING';
  useEffect(() => { if (snapshot.rule_proposal) reload(); }, [snapshot.rule_proposal?.id, snapshot.rule_proposal?.status]);
  const shownRules = settings.locked ? { ...settings.rules } : draft;
  function edit(key: string, value: string | boolean) { setDraft(v => ({ ...v, [key]: value })); setDirty(true); setLocalError(''); }
  function save() {
    const values: Record<string, string | number | boolean> = { ...draft };
    for (const key of Object.keys(settings.rules).filter(k => typeof settings.rules[k as keyof FlushRules] === 'number')) {
      if (!/^\d+$/.test(String(values[key])) || !Number.isSafeInteger(Number(values[key]))) { setLocalError('Enter whole, nonnegative point amounts and counts.'); return; }
      values[key] = Number(values[key]);
    }
    onSave({ rules: values as FlushRules, rules_revision: baseRevision });
    // Keep drafts on rejection. A successful save publishes a new rules revision.
  }
  const pub = snapshot.flush?.public, mine = snapshot.flush?.private;
  const activeGame = snapshot.status === 'playing' && !!pub && pub.status !== 'finished';
  const locking = snapshot.table?.phase === 'OPEN';
  const starting = snapshot.table?.phase === 'LOCKED';
  const formationDisabled = busy || dirty || stale || snapshot.rule_proposal?.status === 'PENDING'
    || !(locking ? snapshot.table?.current_user.can_lock : snapshot.table?.current_user.can_start);
  const centerLabel = starting ? 'Start game' : pub?.settlement ? 'Lock the table to start another game' : 'Lock game';
  const centerControl = snapshot.is_creator && snapshot.status !== 'ended' && (locking || starting)
    ? <Pressable testID="flush-center-start" accessibilityRole="button" accessibilityLabel={centerLabel}
        disabled={formationDisabled} accessibilityState={{ disabled: formationDisabled }}
        onPress={() => locking ? onLock() : onStart(baseRevision)} style={[s.button, { maxWidth: 220 }, formationDisabled && { opacity: 0.45 }]}>
        <ActionCue active={!formationDisabled} style={[s.title, { textAlign: 'center' }]}>{centerLabel}</ActionCue>
      </Pressable> : null;
  const [finalShowOpen, setFinalShowOpen] = useState(false);
  const finalStage = pub?.pending_show ? 'pending' : pub?.settlement ? 'result' : null;
  useEffect(() => { setFinalShowOpen(finalStage !== null); }, [snapshot.match_id, pub?.round_number, finalStage]);
  const comparison = mine?.side_show;
  const preparing = pub?.status === 'awaiting_deal' || pub?.status === 'awaiting_cut';
  const myTurn = !!pub?.current_player_id && pub.current_player_id === String(snapshot.your_player_id);
  const doubleBet = (mine?.actions.required_bet ?? 0) * 2;
  const canDouble = Number.isSafeInteger(doubleBet) && doubleBet > 0;
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
  const button = (label: string, action: () => void, disabled = false) => {
    const attention = ['Deal cards', 'Cut in half', 'Skip cut', 'Reveal cards', 'Fold', 'See cards', 'Accept side-show', 'Decline side-show'].includes(label)
      || label.startsWith('Bet ') || label.startsWith('Show ·') || label === 'Request side-show';
    const caption = label.replace('Bet minimum ·', 'Bet ·').replace('Bet double ·', 'Double ·');
    return <Pressable accessibilityRole="button" accessibilityLabel={label}
      disabled={disabled} accessibilityState={{ disabled }} onPress={action} style={[s.button, disabled && { opacity: 0.45 }]}>
      {attention ? <ActionCue active={!disabled && !busy} style={s.text}>{caption}</ActionCue> : <Text style={s.text}>{caption}</Text>}
    </Pressable>;
  };
  const preparationControl = activeGame && preparing && myTurn ? <View testID="flush-center-preparation" style={{ gap: 8, alignItems: 'center' }}>
    {mine?.actions.kinds.includes('deal_cards') && button('Deal cards', () => act('DEAL_CARDS'), !can('deal_cards'))}
    {mine?.actions.kinds.includes('cut_deck') && button('Cut in half', () => act('CUT_DECK', { position: 26 }), !can('cut_deck'))}
    {mine?.actions.kinds.includes('skip_cut') && button('Skip cut', () => act('SKIP_CUT'), !can('skip_cut'))}
  </View> : null;
  const rulesContent = <>
      <Text style={s.title}>{settings.locked ? 'Rules locked for this game' : 'Rules before starting'}</Text>
      <Text style={s.text}>Every player pays the boot each hand (0 disables it). Betting is unbounded. Contributions and winnings are recorded as points for settlement after play.</Text>
      <Text style={s.text}>You can see your cards on your turn without prior bets. Side-show requires the configured number of completed personal bets (blind or seen), excluding boot. Bet the minimum or double your current blind or seen minimum to raise. Blind bets set the seen minimum using the multiplier; seen bets set the blind minimum by dividing and rounding up. Show always requires exactly two active players. A side-show request costs one seen bet, even if declined; only the two participants can see the compared cards.</Text>
      {stale && dirty && !settings.locked && <Text accessibilityRole="alert" style={s.error}>Saved rules changed. Reload before editing or starting.</Text>}
      {(Object.keys(labels) as (keyof FlushRules)[]).map(key => {
        const value = shownRules[key]; const label = labels[key];
        return <View key={key} style={s.field}><Text style={s.text}>{label}</Text>
          {typeof value === 'boolean' ? button(value ? `${label}: Yes` : `${label}: No`, () => edit(key, !value), !editable || key === 'show_only_when_two_players_remain')
            : key === 'sequence_ace_policy' || key === 'tie_policy' ? <View style={s.row}>{choices[key].map(([v, title]) => <Pressable key={v} accessibilityRole="radio" accessibilityLabel={title}
              accessibilityState={{ checked: value === v, disabled: !editable }} disabled={!editable} onPress={() => edit(key, v)} style={[s.button, value === v && s.chosen]}><Text style={s.text}>{title}</Text></Pressable>)}</View>
            : <TextInput accessibilityLabel={label} value={String(value)} editable={!!editable && key !== 'minimum_players' && key !== 'maximum_players'} keyboardType="number-pad" onChangeText={v => edit(key, v)} style={s.input} />}
        </View>;
      })}
      {!settings.locked && snapshot.is_creator && <View style={s.row}>{button('Propose Flush rules', save, busy || !dirty || stale || snapshot.rule_proposal?.status === 'PENDING')}{button('Reload saved rules', reload, busy)}</View>}
      <Text style={s.text}>{settings.locked ? 'New rules can be chosen for the next game.' : dirty ? 'Propose these changes for approval before starting.' : 'Edits need every seated player’s approval. One rejection keeps the current rules.'}</Text>

      {!!(localError || error) && <Text accessibilityRole="alert" style={s.error}>{localError || error}</Text>}
  </>;
  const available = (kind: string) => snapshot.status === 'playing' && !!mine?.actions.kinds.includes(kind);
  const turnText = pub?.pending_side_show
    ? `${name(pub.pending_side_show.requester_id)} requests a side-show with ${name(pub.pending_side_show.target_id)}`
    : pub?.current_player_id ? myTurn
      ? `Your turn · ${pub.pending_show ? 'Reveal or fold' : pub.status === 'awaiting_deal' ? 'Deal cards' : pub.status === 'awaiting_cut' ? 'Cut or skip' : 'Choose an action'}`
      : `Waiting for ${name(pub.current_player_id)}`
    : pub?.settlement ? 'Round complete' : `${snapshot.players?.length || 0}/${snapshot.capacity} players seated`;
  return <View style={[s.page, mobile && { padding: 8, gap: 4 }]} testID="flush-table">
    <GameTableHeader title="Flush" compact path={snapshot.path} game="flush" roomId={snapshot.room_id} matchId={snapshot.match_id} onBack={onBack} endControl={endControl} mobileTestIds>
      {closeMenu => <>
        <View style={s.row}>{button('Bet history', () => { closeMenu(); setBetsOpen(true); })}{button('Rules', () => { closeMenu(); setRulesOpen(true); })}
          {!!snapshot.your_player_id && button('Poke the table', () => { closeMenu(); setPokeOpen(true); }, !social.connected)}
        </View>
        {tableControl}{lobbyControl}
      </>}
    </GameTableHeader>
    <View style={s.mainColumn} testID="flush-main-column">
      <ScrollView style={s.playViewport} onLayout={e => setArenaHeight(Math.max(280, e.nativeEvent.layout.height))}
        contentContainerStyle={s.playArea}>
        <FlushArena key={`${snapshot.match_id}:${pub?.round_number || 0}`} snapshot={snapshot}
          centerControl={centerControl || preparationControl || (!snapshot.table && snapshot.status === 'waiting'
            ? snapshot.is_creator ? <FlushLockButton onPress={() => onStart(baseRevision)} disabled={busy || !snapshot.ready || dirty || stale} />
              : <Text style={s.text}>Waiting for the creator to lock the table.</Text> : undefined)}
          height={arenaHeight} />
      </ScrollView>
      {pub && <View pointerEvents="none" style={s.notice}><FlushFoldNotice key={`folds:${snapshot.match_id}`} snapshot={snapshot} /></View>}
      <View style={s.handDock} testID="flush-hand-dock">
        {mine && !preparing && !pub?.settlement && <View style={s.cards} testID="flush-own-cards">
          <View style={s.scaledCards}><FlushCards tapToToggle key={pub?.round_number} cards={mine.cards} /></View>
        </View>}
        <Text accessibilityLiveRegion="polite" style={[s.status, myTurn && s.yourTurn]}>{turnText}</Text>
        {!!(localError || error) && <Text accessibilityRole="alert" style={s.error}>{localError || error}</Text>}
        <View style={s.actions} testID="flush-actions">
          {finalStage && button(finalStage === 'pending' ? 'View final show' : 'View round result', () => setFinalShowOpen(true))}
          {!comparisonOpen && <>
            {available('bet') && <>
              {button(`Bet minimum · ${mine!.actions.required_bet} points`, () => act('BET', { amount: mine!.actions.required_bet }), !can('bet'))}
              {canDouble && button(`Bet double · ${doubleBet} points`, () => act('BET', { amount: doubleBet }), !can('bet'))}
            </>}
            {available('see_cards') && button('See cards', () => act('SEE_CARDS'), !can('see_cards'))}
            {available('fold') && button('Fold', () => act('FOLD'), !can('fold'))}
            {available('show') && button(`Show · ${mine!.actions.show_cost} points`, () => act('SHOW'), !can('show'))}
            {available('request_side_show') && button('Request side-show', () => act('REQUEST_SIDE_SHOW'), !can('request_side_show'))}
            {available('accept_side_show') && button('Accept side-show', () => act('ACCEPT_SIDE_SHOW'), !can('accept_side_show'))}
            {available('decline_side_show') && button('Decline side-show', () => act('DECLINE_SIDE_SHOW'), !can('decline_side_show'))}
            {available('reveal_cards') && button('Reveal cards', () => act('REVEAL_CARDS'), !can('reveal_cards'))}
          </>}
        </View>
      </View>
    </View>
    <Modal transparent visible={comparisonOpen && !resultOpen} onRequestClose={acknowledge}>
      <View style={s.backdrop}><View style={s.modal} accessibilityViewIsModal testID="flush-private-comparison">
        <Text style={s.title}>Private side-show</Text>
        <Text style={s.text}>Flip {comparison ? name(comparison.opponent_id) : ''}’s cards</Text>
        {comparison && <FlushCards key={`side-${comparison.revision}`} cards={comparison.opponent_cards} label="Opponent card" onComplete={() => setFlippedAll(true)} />}
      </View></View>
    </Modal>
    {pokeOpen && <PokeComposer recipient={null} connected={social.connected} phrases={social.phrases} onSave={social.save}
      onSend={social.send} onClose={() => setPokeOpen(false)} />}
    <Modal transparent visible={rulesOpen} onRequestClose={() => setRulesOpen(false)}>
      <View style={s.backdrop}><View style={s.modal} accessibilityViewIsModal><View style={s.row}><Text style={s.title}>Rules</Text>{button('Close Flush rules', () => setRulesOpen(false))}</View><Text style={s.text}>Boot is paid by every player each hand; 0 disables it. Betting is unbounded; net points are recorded for settlement after play. Side-show counts each player’s own bets.</Text>
      <ScrollView testID="flush-rules" contentContainerStyle={{ gap: 12 }}>
        {rulesContent}
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
        {can('reveal_cards') && <View style={s.row}>{button('Reveal cards', () => act('REVEAL_CARDS'), busy)}{button('Fold', () => act('FOLD'), busy)}</View>}
      </View>}
      {pub?.settlement && <View style={s.panel} testID="flush-round-result"><Text style={s.title}>Winner: {pub.settlement.winner_ids.map(name).join(', ')}</Text>
        {pub.settlement.payouts.map(p => <Text key={p.player_id} style={s.text}>{name(p.player_id)} receives {p.amount} points</Text>)}
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
  mainColumn: { flex: 1, minWidth: 0, minHeight: 0 },
  playViewport: { flex: 1, minHeight: 0 },
  playArea: { flexGrow: 1 },
  handDock: { flexShrink: 0, borderTopWidth: 1, borderColor: c.border, paddingTop: 4, paddingBottom: 8, gap: 6, alignItems: 'center' },
  cards: { width: 224, height: 128, alignItems: 'center', justifyContent: 'center' },
  scaledCards: { width: 280, height: 172, transform: [{ scale: 0.75 }] },
  status: { color: c.textMuted, fontFamily: fonts.body, fontSize: 13, textAlign: 'center' },
  yourTurn: { color: c.turnText, fontFamily: fonts.medium },
  actions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 6, width: '100%', maxWidth: 900 },
  notice: { position: 'absolute', top: 0, left: 72, right: 72 },
  backdrop: { flex: 1, backgroundColor: c.overlay, alignItems: 'center', justifyContent: 'center', padding: 16 },
  modal: { backgroundColor: c.surface, padding: 16, borderRadius: 14, width: '100%', maxWidth: 720, maxHeight: '90%', gap: 12 },
  panel: { backgroundColor: c.surface, padding: 16, borderRadius: 14, gap: 12 },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  title: { color: c.text, fontFamily: fonts.medium, fontSize: 20 }, text: { color: c.text, fontFamily: fonts.body, fontSize: 14 },
  button: { minHeight: 44, justifyContent: 'center', padding: 10, borderRadius: 8, backgroundColor: c.surfaceRaised, borderWidth: 1, borderColor: c.border },
  chosen: { borderColor: c.accent, backgroundColor: c.surfaceSelected },
  field: { gap: 6 }, input: { padding: 12, borderRadius: 8, borderWidth: 1, borderColor: c.border, color: c.text },
  error: { color: c.danger, fontFamily: fonts.body },
});
