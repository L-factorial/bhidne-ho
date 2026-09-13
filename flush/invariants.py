"""Audit candidate state before every commit; invariant failures are not player errors."""
from card_utils import standard_52
from .enums import GameStatus, PlayerStatus, Visibility, TerminationReason
from .errors import InvariantError


def validate_game_state(state):
    def require(condition, detail):
        if not condition:
            raise InvariantError(detail)
    require(tuple(p.player_id for p in state.players) == state.config.player_ids, 'Roster changed.')
    require(type(state.revision) is int and state.revision >= 0, 'Invalid revision.')
    for p in state.players:
        require(isinstance(p.status, PlayerStatus) and isinstance(p.visibility, Visibility), 'Invalid player flags.')
        require(all(type(v) is int and v >= 0 for v in
                    (p.chips, p.total_contribution, p.blind_bet_count, p.turn_bet_count)), 'Invalid player accounting.')
        require(p.blind_bet_count <= p.turn_bet_count, 'Invalid betting counters.')
    require(type(state.round_number) is int and state.round_number >= 1, 'Invalid round number.')
    require(len(state.round_results) == state.round_number - (state.status is not GameStatus.FINISHED),
            'Round ledger length mismatch.')
    for number, result in enumerate(state.round_results, 1):
        require(result.round_number == number and bool(result.winner_ids)
                and set(result.winner_ids) <= {p.player_id for p in result.net_changes}, 'Invalid ledger round.')
        require(len({p.player_id for p in result.net_changes}) == len(result.net_changes)
                and all(type(p.amount) is int for p in result.net_changes)
                and sum(p.amount for p in result.net_changes) == 0, 'Invalid round net changes.')
    if state.status is GameStatus.FINISHED:
        require(tuple(p.amount for p in state.round_results[-1].net_changes) ==
                tuple(p.chips - initial for p, initial in zip(state.players, state.config.initial_chips)),
                'Ledger differs from settled balances.')
    require(state.pot == sum(p.total_contribution for p in state.players), 'Pot differs from contributions.')
    require(sum(p.chips for p in state.players) + state.held_pot == sum(state.config.initial_chips),
            'Chips were created or lost.')
    payouts = {p.player_id: p.amount for p in state.settlement.payouts} if state.settlement else {}
    require(all(p.chips == initial - p.total_contribution + payouts.get(p.player_id, 0)
                for p, initial in zip(state.players, state.config.initial_chips)), 'Individual chip balance mismatch.')
    if state.pending_show:
        request = state.pending_show
        require(state.status is GameStatus.IN_PROGRESS and state.pending_side_show is None,
                'Final show requires an active round without a side-show.')
        require({request.requester_id, request.target_id} == {p.player_id for p in state.players if p.status is PlayerStatus.ACTIVE}
                and request.requester_id != request.target_id and state.current_player_id == request.target_id,
                'Invalid final-show participants or turn.')
        require(tuple(h.player_id for h in state.revealed_hands) == (request.requester_id,),
                'Only requester cards may be public before the response.')
    elif state.status is not GameStatus.FINISHED:
        require(not state.revealed_hands, 'Unexpected public cards.')
    require(all(h.cards == next(p.cards for p in state.players if p.player_id == h.player_id)
                for h in state.revealed_hands), 'Public cards differ from holdings.')
    request = state.pending_side_show
    if request is not None:
        require(state.status is GameStatus.IN_PROGRESS and state.config.rules.allow_side_show,
                'Pending side-show requires an active enabled round.')
        require(request.requester_id != request.target_id
                and {request.requester_id, request.target_id} <= set(state.config.player_ids), 'Invalid side-show seats.')
        require(all(p.status is PlayerStatus.ACTIVE and p.visibility is Visibility.SEEN
                    for p in state.players if p.player_id in (request.requester_id, request.target_id)), 'Side-show requires active seen players.')
        require(sum(p.status is PlayerStatus.ACTIVE for p in state.players) >= 3, 'Side-show requires at least three active players.')
        require(state.current_player_id == request.target_id, 'Only side-show target is actionable.')
    for result in state.side_shows:
        require(result.requester_id != result.target_id
                and {result.winner_id, result.loser_id} == {result.requester_id, result.target_id}, 'Invalid side-show result seats.')
        require(all(next(p for p in state.players if p.player_id == seat).cards == cards
                    for seat, cards in ((result.requester_id, result.requester_cards), (result.target_id, result.target_cards))),
                'Side-show cards must match authoritative holdings.')
        require(next(p for p in state.players if p.player_id == result.loser_id).status is PlayerStatus.FOLDED,
                'Side-show loser must fold.')
    if state.status is GameStatus.WAITING:
        require(not state.stock and all(not p.cards and p.total_contribution == 0 and p.turn_bet_count == 0
                    and p.visibility is Visibility.BLIND and p.status is PlayerStatus.ACTIVE for p in state.players),
                'Waiting game has started holdings.')
        require(state.current_seat is None and state.settlement is None and not state.history
                and state.revision == 0 and not state.side_shows and state.pending_side_show is None, 'Invalid waiting lifecycle.')
        return
    if state.status in (GameStatus.AWAITING_DEAL, GameStatus.AWAITING_CUT):
        require(all(not p.cards and p.total_contribution == p.turn_bet_count == 0
                    and p.visibility is Visibility.BLIND and p.status is PlayerStatus.ACTIVE
                    for p in state.players), 'Preparation must not deal or debit players.')
        dealer = state.config.player_ids.index(state.config.dealer_id)
        require(state.current_seat == (dealer if state.status is GameStatus.AWAITING_DEAL
                                      else (dealer + 1) % len(state.players)), 'Invalid preparation turn.')
        require(not state.settlement and not state.side_shows and state.pending_side_show is None,
                'Invalid preparation state.')
        require(state.current_blind_bet == state.current_seen_bet == 0, 'Preparation has betting stakes.')
        require((not state.stock) if state.status is GameStatus.AWAITING_DEAL else
                (len(state.stock) == 52 and set(state.stock) == set(standard_52())), 'Invalid prepared deck.')
        require(state.revision == state.round_start_revision + (0 if state.status is GameStatus.AWAITING_DEAL else 1)
                and state.history[-1].revision == state.revision, 'Invalid preparation revision.')
        return
    cards = tuple(c for p in state.players for c in p.cards) + state.stock
    require(len(cards) == 52 and set(cards) == set(standard_52()), 'Cards are duplicated, missing, or counterfeit.')
    require(all(len(p.cards) == 3 for p in state.players), 'Every player must retain three cards.')
    multiplier = state.config.rules.blind_to_seen_bet_multiplier
    require(type(state.current_seen_bet) is int and type(state.current_blind_bet) is int
            and state.current_seen_bet >= state.config.rules.initial_blind_bet * multiplier
            and state.current_blind_bet == (state.current_seen_bet + multiplier - 1) // multiplier,
            'Invalid current betting minimums.')
    active = tuple(p.player_id for p in state.players if p.status is PlayerStatus.ACTIVE)
    if state.status is GameStatus.IN_PROGRESS:
        require(len(active) >= 2 and state.settlement is None, 'Invalid active round.')
        require(type(state.current_seat) is int and 0 <= state.current_seat < len(state.players), 'Invalid turn index.')
        require(state.current_player_id in active, 'Turn belongs to inactive player.')
    else:
        require(state.status is GameStatus.FINISHED and state.current_seat is None and state.settlement is not None,
                'Invalid terminal lifecycle.')
        result = state.settlement
        require(bool(result.winner_ids) and len(set(result.winner_ids)) == len(result.winner_ids)
                and set(result.winner_ids) <= set(active), 'Invalid winners.')
        require(tuple(p.player_id for p in result.payouts) == result.winner_ids
                and all(type(p.amount) is int and p.amount >= 0 for p in result.payouts)
                and sum(p.amount for p in result.payouts) == state.pot, 'Invalid payouts.')
        if result.reason is TerminationReason.LAST_PLAYER_REMAINING:
            require(len(active) == 1 and not result.shown_hands and result.winning_hand is None,
                    'Fold win must not show cards.')
        elif result.reason is TerminationReason.SHOW_FOLD:
            require(len(active) == 1 and tuple(h.player_id for h in result.shown_hands) == active
                    and result.winning_hand is None, 'A declined show only reveals the requester.')
        else:
            require(result.reason is TerminationReason.SHOW and len(active) == 2
                    and tuple(h.player_id for h in result.shown_hands) == active
                    and all(h.cards == next(p.cards for p in state.players if p.player_id == h.player_id)
                            for h in result.shown_hands), 'Invalid showdown.')
    require(tuple(e.sequence for e in state.history) == tuple(range(1, len(state.history) + 1)), 'Event sequence gap.')
    require(bool(state.history) and state.history[-1].revision == state.revision
            and all(1 <= e.revision <= state.revision for e in state.history)
            and all(a.revision <= b.revision for a, b in zip(state.history, state.history[1:])), 'Invalid event revisions.')
