import { HandAreaBar } from '../components/HandAreaBar';
import { showTableHeaderShare } from '../multiplayer/tableHeaderSharing';
import { FloatingTableAction } from '../components/FloatingTableAction';
import { RoundResultsTable } from '../components/RoundResultsTable';
import { RoomSheet } from '../components/RoomSheet';
import { FormFooter } from '../components/FormFooter';
import { NumericInput } from '../components/NumericInput';
import { GameMenuMetadata } from '../components/GameMenu';
import { useSocialHandAnchor } from '../components/TableSocial';
import { EndedTableNotice } from '../components/EndedTableNotice';
import { FlushMenu } from '../components/FlushMenu';
import { GameTableHeader } from '../components/GameTableHeader';
import { flushDecision } from '../multiplayer/flushDecision';
import { type ReactNode, useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { fonts, gameButtonStyle, useTheme, useThemedStyles, type ThemeColors } from '../theme';
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

export function FlushTable({ snapshot, busy, error, connectionReady, onSave, onStart, onLock, onAction, onBack, onNewGame, endControl, lobbyControl, social, onFormationBlocked, tableControl }: {
  connectionReady: boolean;
  tableControl?: ReactNode;
  onLock: () => void;
  onFormationBlocked?: (blocked: boolean) => void;
  social: { connected: boolean; phrases: PlayerPhrase[]; save: (text: string) => Promise<void>; send: (text: string) => Promise<void> };
  snapshot: RoomSnapshot; busy: boolean; error: string; endControl?: ReactNode; lobbyControl?: ReactNode;
  onSave: (payload: { rules: FlushRules; rules_revision: number }) => void;
  onStart: (revision: number) => void; onAction: (command: string, payload?: object) => void;
  onBack: () => void; onNewGame: () => void;
}) {
  const { colors } = useTheme();
  const s = useThemedStyles(styles);
  const ended = snapshot.status === 'ended';
  const endedNotice = <EndedTableNotice onBack={onBack} onNewGame={onNewGame} />;
  const width = useWindowDimensions().width;
  const mobile = width < 900;
  const act = onAction;
  const settings = snapshot.flush_settings!;
  const [handOpen, setHandOpen] = useState(true);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [betsOpen, setBetsOpen] = useState(false);
  const socialAnchor = useSocialHandAnchor();
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
  const editable = !ended && snapshot.is_creator && !settings.locked && !busy && snapshot.rule_proposal?.status !== 'PENDING';
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
  const centerLabel = starting ? 'Start game' : 'Lock players';
  const formation = snapshot.status !== 'ended' && (locking || starting);
  const centerControl = formation ? <View style={{ backgroundColor: 'transparent', borderRadius: 18, padding: 12, gap: 8, alignItems: 'center', maxWidth: 220 }}>
    <Text style={{ color: colors.text, fontFamily: fonts.medium, fontSize: 15, textAlign: 'center' }}>{starting ? 'Players locked' : 'Waiting for players'}</Text>
    <Text style={{ color: colors.textMuted, fontSize: 12 }}>{snapshot.players?.length || 0} of {snapshot.table?.max_players || snapshot.capacity} seated</Text>
    {snapshot.is_creator ? <FloatingTableAction testID="flush-center-start" label={centerLabel}
      disabled={formationDisabled} onPress={() => locking ? onLock() : onStart(baseRevision)} /> : <Text style={{ color: colors.textMuted, textAlign: 'center', fontSize: 12 }}>Waiting for the host</Text>}
    {(snapshot.players?.length || 0) < (snapshot.table?.min_players || 2) && <Text style={{ color: colors.textMuted, textAlign: 'center', fontSize: 11 }}>Need at least {snapshot.table?.min_players || 2} players</Text>}
    {formationDisabled && (snapshot.players?.length || 0) >= (snapshot.table?.min_players || 2) && <Text style={{ color: colors.textMuted, textAlign: 'center', fontSize: 11 }}>{dirty || stale ? 'Save or reload rule changes first.' : snapshot.rule_proposal?.status === 'PENDING' ? 'Waiting for rule approval.' : 'Waiting for eligible players.'}</Text>}
  </View> : null;
  const [finalShowOpen, setFinalShowOpen] = useState(false);
  const finalStage = ended ? null : pub?.pending_show ? 'pending' : pub?.settlement ? 'result' : null;
  useEffect(() => { setFinalShowOpen(finalStage !== null); }, [snapshot.match_id, pub?.round_number, finalStage]);
  const comparison = mine?.side_show;
  const preparing = pub?.status === 'awaiting_deal' || pub?.status === 'awaiting_cut';
  const decision = flushDecision(snapshot.flush, snapshot.status === 'playing');
  const myTurn = !!decision && decision.actor === String(snapshot.your_player_id);
  const ownPlayer = pub?.players.find(p => p.player_id === String(snapshot.your_player_id));
  const visibility = ownPlayer?.visibility === 'seen' ? 'Seen' : 'Blind';
  const [helpOpen, setHelpOpen] = useState(false);
  useEffect(() => { setHelpOpen(false); }, [decision?.key]);
  const doubleBet = (mine?.actions.required_bet ?? 0) * 2;
  const canDouble = Number.isSafeInteger(doubleBet) && doubleBet > 0;
  const ackKey = `bhidne.flush-side-show:${snapshot.match_id}:${snapshot.your_player_id}`;
  const [acknowledged, setAcknowledged] = useState(() => { try { return Number(globalThis.sessionStorage?.getItem(ackKey) || 0); } catch { return 0; } });
  const [flippedAll, setFlippedAll] = useState(false);
  const [resultOpen, setResultOpen] = useState(false);
  const comparisonOpen = !ended && !!comparison && comparison.revision > acknowledged;
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
    const primary = /^(Bet minimum|Show ·|Deal cards|Reveal cards|Accept side-show)/.test(label);
    const caption = label.replace('Bet minimum ·', `${visibility === 'Blind' ? 'Blind' : 'Bet'} ·`).replace('Bet double ·', 'Double ·');
    return <Pressable accessibilityRole="button" accessibilityLabel={label}
      disabled={disabled} accessibilityState={{ disabled }} onPress={action} style={({ pressed }) => [s.button, gameButtonStyle(colors, primary ? 'primary' : 'secondary', pressed), disabled && { opacity: 0.45 }]}>
      <Text style={[s.text, primary && { color: colors.onPrimary }, label === 'Fold' && { color: colors.onTableHeader }]}>{caption}</Text>
    </Pressable>;
  };
  const preparationControl = activeGame && preparing && myTurn ? <View testID="flush-center-preparation" style={{ gap: 8, alignItems: 'center' }}>
    {mine?.actions.kinds.includes('deal_cards') && <FloatingTableAction label="Deal cards" onPress={() => act('DEAL_CARDS')} disabled={!can('deal_cards')} />}
    {mine?.actions.kinds.includes('cut_deck') && <FloatingTableAction label="Cut in half" onPress={() => act('CUT_DECK', { position: 26 })} disabled={!can('cut_deck')} />}
    {mine?.actions.kinds.includes('skip_cut') && <FloatingTableAction label="Skip cut" onPress={() => act('SKIP_CUT')} disabled={!can('skip_cut')} />}
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
            : <NumericInput accessibilityLabel={label} value={String(value)} editable={!!editable && key !== 'minimum_players' && key !== 'maximum_players'} keyboardType="number-pad" onChangeText={v => edit(key, v)} style={s.input} />}
        </View>;
      })}

      <Text style={s.text}>{settings.locked ? 'New rules can be chosen for the next game.' : dirty ? 'Propose these changes for approval before starting.' : 'Edits need every seated player’s approval. One rejection keeps the current rules.'}</Text>
      {(settings.locked || !snapshot.is_creator) && !!(localError || error) && <Text accessibilityRole="alert" style={s.error}>{localError || error}</Text>}
  </>;
  const available = (kind: string) => snapshot.status === 'playing' && !!mine?.actions.kinds.includes(kind);
  const help = myTurn && available('bet') ? [
    !mine?.actions.show.allowed && mine?.actions.show.reason ? `Show: ${mine.actions.show.reason}` : null,
    settings.rules.allow_side_show && !mine?.actions.side_show.allowed && mine?.actions.side_show.reason ? `Side-show: ${mine.actions.side_show.reason}` : null,
  ].filter(Boolean) : [];
  const turnText = ended ? 'Table ended' : pub?.settlement ? 'Round complete' : decision ? myTurn
    ? pub?.pending_side_show ? `Accept or decline ${name(pub.pending_side_show.requester_id)}’s side-show`
      : pub?.pending_show ? 'Reveal or fold'
      : preparing ? `${pub?.status === 'awaiting_deal' ? 'Deal cards' : 'Cut or skip'}`
      : `${visibility} · Choose an action`
    : `${ownPlayer?.status === 'active' && !preparing ? `${visibility} · ` : ownPlayer?.status === 'folded' ? 'Folded · ' : ''}Waiting for ${name(decision.actor)}`
    : `${snapshot.players?.length || 0}/${snapshot.capacity} players seated`;
  return <View style={[s.page, mobile && { padding: 8, gap: 4 }]} testID="flush-table">
    <GameTableHeader showShare={showTableHeaderShare(snapshot)} tableName={snapshot.table_name} title="Flush" compact path={snapshot.path} game="flush" roomId={snapshot.room_id} matchId={snapshot.match_id} onBack={onBack} mobileTestIds drawerMetadata={<GameMenuMetadata snapshot={snapshot} />}>
      {closeMenu => <FlushMenu snapshot={snapshot} close={closeMenu} rules={() => setRulesOpen(true)} history={() => setBetsOpen(true)}
        poke={() => setPokeOpen(true)} canPoke={social.connected} back={onBack} tableControl={tableControl} leaveControl={lobbyControl} endControl={endControl} />}
    </GameTableHeader>
    <View style={s.mainColumn} testID="flush-main-column">
      <ScrollView style={s.playViewport} onLayout={e => setArenaHeight(Math.max(280, e.nativeEvent.layout.height))}
        contentContainerStyle={s.playArea}>
        <FlushArena key={`${snapshot.match_id}:${pub?.round_number || 0}`} snapshot={snapshot}
          centerControl={ended ? endedNotice : centerControl || preparationControl || (!snapshot.table && snapshot.status === 'waiting'
            ? snapshot.is_creator ? <FlushLockButton onPress={() => onStart(baseRevision)} disabled={busy || !snapshot.ready || dirty || stale} />
              : <Text style={s.text}>Waiting for the creator to lock the table.</Text> : undefined)}
          height={arenaHeight} />
      </ScrollView>
      {pub && <View pointerEvents="none" style={s.notice}><FlushFoldNotice key={`folds:${snapshot.match_id}`} snapshot={snapshot} /></View>}
      <View ref={socialAnchor.ref} onLayout={socialAnchor.onLayout} style={s.handDock} testID="flush-hand-dock">
        {!!mine && <HandAreaBar open={handOpen} onToggle={() => setHandOpen(value=>!value)} attention={myTurn && connectionReady && !ended}
          instruction={`Your turn · ${turnText}`}/>}
        <View style={{display:!mine || handOpen?'flex':'none',alignItems:'center',gap:6,alignSelf:'stretch'}} accessibilityElementsHidden={!!mine&&!handOpen} importantForAccessibility={mine&&!handOpen?'no-hide-descendants':'auto'}>
        {!ended && mine && !preparing && !pub?.settlement && <View style={s.cards} testID="flush-own-cards">
          <View style={s.scaledCards}><FlushCards tapToToggle key={pub?.round_number} cards={mine.cards} /></View>
        </View>}
        <Text accessibilityLiveRegion="polite" style={[s.status, { backgroundColor: colors.tableHeader, borderRadius: 8, color: colors.onTableHeader }]}>{!ended && !connectionReady ? 'Reconnecting… Updating game' : busy && myTurn ? 'Sending your action…' : turnText}</Text>
        {!!(localError || error) && <Text accessibilityRole="alert" style={s.error}>{localError || error}</Text>}
        <View style={s.actions} testID="flush-actions">
          {finalStage && button(finalStage === 'pending' ? 'View final show' : 'View round result', () => setFinalShowOpen(true))}
          {!comparisonOpen && <>
            {available('bet') && <>
              {button(`Bet minimum · ${mine!.actions.required_bet} points`, () => act('BET', { amount: mine!.actions.required_bet }), !can('bet'))}
              {canDouble && button(`Bet double · ${doubleBet} points`, () => act('BET', { amount: doubleBet }), !can('bet'))}
            </>}
            {available('see_cards') && button('See cards', () => act('SEE_CARDS'), !can('see_cards'))}
            {available('show') && button(`Show · ${mine!.actions.show_cost} points`, () => act('SHOW'), !can('show'))}
            {available('request_side_show') && button('Request side-show', () => act('REQUEST_SIDE_SHOW'), !can('request_side_show'))}
            {available('accept_side_show') && button('Accept side-show', () => act('ACCEPT_SIDE_SHOW'), !can('accept_side_show'))}
            {available('decline_side_show') && button('Decline side-show', () => act('DECLINE_SIDE_SHOW'), !can('decline_side_show'))}
            {available('reveal_cards') && button('Reveal cards', () => act('REVEAL_CARDS'), !can('reveal_cards'))}
            {available('fold') && button('Fold', () => act('FOLD'), !can('fold'))}
          </>}
        </View>
        {!comparisonOpen && help.length > 0 && <>
          <Pressable accessibilityRole="button" accessibilityState={{ expanded: helpOpen }} onPress={() => setHelpOpen(value => !value)} style={s.helpButton}>
            <Text style={s.status}>{helpOpen ? 'Hide action help' : 'Why are some actions unavailable?'}</Text>
          </Pressable>
          {helpOpen && help.map(reason => <Text key={reason} style={s.status}>{reason}</Text>)}
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
    {!ended && pokeOpen && <PokeComposer recipient={null} connected={social.connected} phrases={social.phrases} onSave={social.save}
      onSend={social.send} onClose={() => setPokeOpen(false)} />}
    <RoomSheet visible={rulesOpen} title="Flush rules" closeLabel="Close Flush rules" onClose={() => setRulesOpen(false)} testID="flush-rules"
      footer={!settings.locked && snapshot.is_creator ? <FormFooter>{!!(localError || error) && <Text accessibilityRole="alert" style={s.error}>{localError || error}</Text>}<View style={[s.row, { flexWrap: 'wrap' }]}>{button('Propose Flush rules', save, busy || !dirty || stale || snapshot.rule_proposal?.status === 'PENDING')}{button('Reload saved rules', reload, busy)}</View></FormFooter> : undefined}>
      {rulesContent}
    </RoomSheet>
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
      {pub?.settlement && <View style={s.panel} testID="flush-round-result"><RoundResultsTable subtitle={`Winner: ${pub.settlement.winner_ids.map(name).join(', ')}`} columns={['Payout', 'Net']} rows={(pub.round_results.find(r => r.round_number === pub.round_number)?.net_changes || pub.settlement.payouts).map(p => {
          const net = pub.round_results.find(r => r.round_number === pub.round_number)?.net_changes.find(row => row.player_id === p.player_id)?.amount;
          const payout = pub.settlement!.payouts.find(row => row.player_id === p.player_id)?.amount || 0;
          return { id: p.player_id, name: name(p.player_id), avatarUrl: snapshot.players?.find(player => String(player.player_id) === p.player_id)?.avatar_url,
            own: p.player_id === String(snapshot.your_player_id), winner: pub.settlement!.winner_ids.includes(p.player_id),
            values: [{ text: String(payout) }, { text: net === undefined ? '—' : `${net > 0 ? '+' : ''}${net}`, amount: net }] };
        })} />
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
  playArea: { flexGrow: 1, backgroundColor: c.table },
  handDock: { backgroundColor: c.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, flexShrink: 0, borderTopWidth: 1, borderColor: c.tableTrim, paddingTop: 4, paddingBottom: 8, gap: 6, alignItems: 'center' },
  cards: { width: 224, height: 128, alignItems: 'center', justifyContent: 'center' },
  scaledCards: { width: 280, height: 172, transform: [{ scale: 0.75 }] },
  status: { color: c.textMuted, fontFamily: fonts.body, fontSize: 13, textAlign: 'center' },
  yourTurn: { color: c.turnText, fontFamily: fonts.medium, backgroundColor: c.turnSurface, borderWidth: 1, borderColor: c.attention, borderRadius: 8, paddingVertical: 6, paddingHorizontal: 10 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 6, width: '100%', maxWidth: 900 },
  notice: { position: 'absolute', top: 0, left: 72, right: 72 },
  backdrop: { flex: 1, backgroundColor: c.overlay, alignItems: 'center', justifyContent: 'center', padding: 16 },
  modal: { backgroundColor: c.surface, padding: 16, borderRadius: 14, width: '100%', maxWidth: 720, maxHeight: '90%', gap: 12 },
  panel: { backgroundColor: c.surface, padding: 16, borderRadius: 14, gap: 12 },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  title: { color: c.text, fontFamily: fonts.medium, fontSize: 20 }, text: { color: c.text, fontFamily: fonts.body, fontSize: 14 },
  button: { justifyContent: 'center', padding: 10, ...gameButtonStyle(c) },
  helpButton: { ...gameButtonStyle(c), justifyContent: 'center', paddingHorizontal: 8 },
  chosen: { borderColor: c.accent, backgroundColor: c.surfaceSelected },
  field: { gap: 6 }, input: { padding: 12, borderRadius: 8, borderWidth: 1, borderColor: c.border, color: c.text },
  error: { color: c.danger, fontFamily: fonts.body },
});
