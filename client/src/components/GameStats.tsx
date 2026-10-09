import { useEffect, useState, type ReactNode } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { Pressable, ScrollView, View } from 'react-native';
import { AppText as Text } from './AppText';
import { MarriageMeldCards } from './MarriageMeldCards';
import { useTheme, fonts, radii } from '../theme';
import { ui } from '../i18n/copy';
import { useUiLanguage } from '../i18n/useUiLanguage';
import { callBreakPreviousStats, callBreakTrickHistory, flushStatsHistory } from '../multiplayer/gameStats';
import type { RoomSnapshot } from '../screens/LiveGameTable';

export function useGameStats(matchId?: string, viewer?: number | null) {
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [matchId, viewer]);
  return { open, show: () => setOpen(true), close: () => setOpen(false) };
}

/** Mounted inside the play viewport: header and collapsed hand remain outside. */
export function GameStats({ snapshot, open, onOpen, onClose, children }: {
  snapshot: RoomSnapshot; open: boolean; onOpen: () => void; onClose: () => void; children: ReactNode;
}) {
  useUiLanguage();
  const { colors: c } = useTheme();
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => { if (open) setSelected(null); }, [open, snapshot.match_id, snapshot.your_player_id]);
  const roster = snapshot.flush?.participants || (snapshot.players || []).map(player => ({ player_id: String(player.player_id), display_name: player.display_name || ui('common.player_number', { number: player.player_id }) }));
  const name = (id: string | number | null | undefined) => roster.find(player => player.player_id === String(id))?.display_name || ui('common.player_number', { number: id ?? '—' });
  // A departing player's tab cannot silently turn into another player's stats.
  const playerId = selected && roster.some(player => player.player_id === selected) ? selected : null;
  const players = roster.filter(player => playerId === null || player.player_id === playerId);
  const text = { color: c.text, fontFamily: fonts.body, fontSize: 14 };
  const muted = { ...text, color: c.textMuted };
  const section = { padding: 12, gap: 8, borderWidth: 1, borderColor: c.borderSubtle, borderRadius: radii.medium, backgroundColor: c.surfaceRaised };
  const callbreak = snapshot.game_type === 'callbreak' || !!snapshot.deal;
  const history = callBreakTrickHistory(snapshot, playerId);
  const flushHistory = flushStatsHistory(snapshot, playerId);
  return <View style={{ flex: 1, minHeight: 0, minWidth: 0, position: 'relative' }}>
    <View style={{ flexDirection: 'row', padding: 4, backgroundColor: c.table, flexShrink: 0 }}>
      <Pressable testID="game-stats-toggle" accessibilityRole="button" accessibilityLabel={ui('common.game_stats')} accessibilityState={{ expanded: open }}
        onPress={open ? onClose : onOpen} style={{ minHeight: 44, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: radii.medium, backgroundColor: c.surface }}>
        <Ionicons name="stats-chart-outline" size={18} color={c.accent} /><Text style={{ ...text, fontFamily: fonts.medium }}>{ui('common.game_stats')}</Text>
      </Pressable>
    </View>
    <View style={{ flex: 1, minHeight: 0 }} accessibilityElementsHidden={open} importantForAccessibility={open ? 'no-hide-descendants' : 'auto'} aria-hidden={open} pointerEvents={open ? 'none' : 'auto'}>{children}</View>
    {open && <View testID="game-stats-overlay" accessibilityLabel={ui('common.game_stats')} style={{ position: 'absolute', inset: 0, zIndex: 40, elevation: 20, backgroundColor: c.surface, borderWidth: 1, borderColor: c.border, borderRadius: radii.medium, overflow: 'hidden' }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingLeft: 12, borderBottomWidth: 1, borderColor: c.border }}>
        <Text accessibilityRole="header" style={{ ...text, fontFamily: fonts.medium, flex: 1 }}>{ui('common.game_stats')}</Text>
        <Pressable testID="game-stats-close" accessibilityRole="button" accessibilityLabel={ui('common.close_game_stats')} onPress={onClose} style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}><Ionicons name="close" size={22} color={c.text} /></Pressable>
      </View>
      <View style={{ flexShrink: 0, padding: 8 }}><ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={{ gap: 6 }} accessibilityRole="tablist" accessibilityLabel={ui('common.game_stats')}>
        {[{ player_id: null, display_name: ui('rooms.all') }, ...roster].map(player => <Pressable key={player.player_id ?? 'all'} accessibilityRole="tab" accessibilityLabel={player.display_name} aria-selected={playerId === player.player_id} accessibilityState={{ selected: playerId === player.player_id }}
          onPress={() => setSelected(player.player_id)} style={{ minHeight: 44, paddingHorizontal: 12, justifyContent: 'center', borderRadius: radii.medium, borderWidth: 1, borderColor: playerId === player.player_id ? c.accent : c.border, backgroundColor: playerId === player.player_id ? c.surfaceSelected : c.surface }}>
          <Text style={text}>{player.display_name}</Text>
        </Pressable>)}
      </ScrollView></View>
      <ScrollView key={playerId ?? 'all'} testID="game-stats-content" style={{ flex: 1, minHeight: 0 }} contentContainerStyle={{ padding: 12, gap: 12 }} nestedScrollEnabled keyboardShouldPersistTaps="handled">
        {callbreak && snapshot.deal && <Text style={{ ...text, color: c.accent }}>{ui('common.stats_round_trick', { round: snapshot.deal.deal_number, trick: snapshot.game?.current_trick?.trick_number ?? Math.min(snapshot.deal.tricks_completed + 1, snapshot.deal.tricks_required) })}</Text>}
        {snapshot.flush && <Text style={{ ...text, color: c.accent }}>{ui('flush.round_number', { number: snapshot.flush.public.round_number })}</Text>}
        {players.map(player => {
          const id = player.player_id;
          const marriage = snapshot.marriage?.public.players.find(row => row.player_id === id);
          const flush = snapshot.flush?.public.players.find(row => row.player_id === id);
          const bid = snapshot.deal?.players.find(row => String(row.player_id) === id);
          const previous = callBreakPreviousStats(snapshot, Number(id));
          return <View key={id} testID={`game-stats-player-${id}`} style={section}>
            <Text accessibilityRole="header" style={{ ...text, fontFamily: fonts.medium }}>{player.display_name}</Text>
            {callbreak && <>
              <Text style={muted}>{ui('common.stats_previous_bid_bonus', previous)}</Text>
              <Text style={text}>{ui('common.stats_current_bid_won', { bid: bid?.bid ?? '—', won: bid?.tricks_won ?? 0 })}</Text>
              {(snapshot.deal_history || []).filter(round => round.complete).map(round => {
                const result = round.players.find(row => String(row.player_id) === id);
                return result && <Text key={round.deal_number} style={muted}>{ui('common.stats_round_standing', { round: round.deal_number, bid: result.bid ?? '—', won: result.tricks_won })}</Text>;
              })}
            </>}
            {marriage && <>
              <Text style={text}>{marriage.has_seen_maal ? ui('marriage.maal_seen') : ui('marriage.maal_not_seen')}</Text>
              <Text style={text}>{marriage.route === 'dublee' ? ui('marriage.7_dublees') : marriage.route === 'normal' ? ui('marriage.3_sequences_tunnelas') : ui('marriage.not_shown')}</Text>
              <Text style={muted}>{ui('common.count_cards', { count: marriage.hand_count })} · {marriage.folded ? ui('marriage.folded') : marriage.finished ? ui('marriage.winner') : snapshot.marriage?.public.current_player_id === id ? ui('common.current_turn') : ui('marriage.waiting_for_turn')}</Text>
              {!!marriage.initial_tunnelas?.length && <><Text style={text}>{ui('marriage.initial_tunnelas_shown')}</Text><MarriageMeldCards groups={marriage.initial_tunnelas} /></>}
              {!!marriage.shown_melds.length && <><Text style={text}>{ui('marriage.shown_cards')}</Text><MarriageMeldCards groups={marriage.shown_melds} /></>}
            </>}
            {flush && <>
              <Text style={text}>{flush.visibility === 'seen' ? ui('flush.seen') : ui('flush.blind')} · {flush.status === 'folded' ? ui('flush.folded') : flush.status === 'out' ? ui('flush.stats_out') : ui('rooms.active')}</Text>
              <Text style={muted}>{ui('common.stats_flush_totals', { blind: flush.blind_bet_count, bets: flush.turn_bet_count, contribution: flush.total_contribution })}</Text>
            </>}
            {snapshot.flush && !flush && <Text style={muted}>{ui('flush.stats_not_in_round')}</Text>}
            {snapshot.flush?.public.round_results.map(round => {
              const result = round.net_changes.find(row => row.player_id === id);
              return result && <Text key={round.round_number} style={muted}>{ui('flush.round_number', { number: round.round_number })} · {ui('flush.net')} {result.amount > 0 ? '+' : ''}{result.amount}</Text>;
            })}
          </View>;
        })}
        {callbreak && <>
          <Text accessibilityRole="header" style={text}>{ui('common.stats_trick_history')}</Text>
          {!history.length && <Text style={muted}>{ui('common.stats_no_tricks')}</Text>}
          {history.map(trick => <View key={`${trick.round}:${trick.trick_number}`} style={section}>
            <Text style={text}>{ui('common.stats_round_trick', { round: trick.round, trick: trick.trick_number })} · {ui('common.stats_winner', { player: name(trick.winner) })}</Text>
            {trick.plays.filter(play => playerId === null || String(play.player_id) === playerId).map(play => <Text key={play.player_id} style={muted}>{name(play.player_id)} · {play.card.replace(/S$/, '♠').replace(/H$/, '♥').replace(/D$/, '♦').replace(/C$/, '♣')}</Text>)}
          </View>)}
        </>}
        {snapshot.flush && <>
          <Text accessibilityRole="header" style={text}>{ui('common.stats_action_history')}</Text>
          {!flushHistory.length && <Text style={muted}>{ui('common.stats_no_actions')}</Text>}
          {flushHistory.map(event => <View key={event.sequence} style={section}>
            <Text style={muted}>{ui('flush.round_number', { number: event.round_number })}{event.bet_number ? ` · ${ui('flush.stats_bet_number', { number: event.bet_number })}` : ''}{event.visibility ? ` · ${ui(event.visibility === 'seen' ? 'flush.seen' : 'flush.blind')}` : ''}</Text>
            <Text style={text}>{event.player_id ? `${name(event.player_id)} · ` : ''}{flushEventLabel(event.kind)}{event.amount ? ` · ${event.amount}` : ''}</Text>
            {!!event.target_player_id && <Text style={muted}>{ui('common.stats_target', { player: name(event.target_player_id) })}</Text>}
            {!!event.loser_player_id && <Text style={muted}>{name(event.loser_player_id)} · {ui('flush.folded')}</Text>}
            {!!event.winner_ids.length && <Text style={muted}>{ui('common.stats_winner', { player: event.winner_ids.map(name).join(', ') })}</Text>}
          </View>)}
        </>}
        {!snapshot.marriage && !snapshot.flush && !snapshot.deal && <Text style={muted}>{ui('common.stats_not_started')}</Text>}
      </ScrollView>
    </View>}
  </View>;
}

function flushEventLabel(kind: string) {
  const keys = {
    BOOT_COLLECTED: 'flush.stats_boot', BET_PLACED: 'flush.stats_bet', CARDS_SEEN: 'flush.stats_seen', PLAYER_FOLDED: 'flush.folded',
    SHOW_REQUESTED: 'flush.stats_show', SIDE_SHOW_REQUESTED: 'flush.stats_side_show', SIDE_SHOW_ACCEPTED: 'flush.stats_side_accepted',
    SIDE_SHOW_DECLINED: 'flush.stats_side_declined', SIDE_SHOW_RESOLVED: 'flush.stats_side_resolved', ROUND_FINISHED: 'flush.stats_finished',
  } as const;
  return kind in keys ? ui(keys[kind as keyof typeof keys]) : kind;
}
