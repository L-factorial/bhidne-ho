"""Marriage-style transactional facade. Callers serialize use of each instance."""
from collections.abc import Mapping
from dataclasses import replace
from random import Random
from card_utils import standard_52, shuffle, deal
from .actions import RevealCards, StartNextRound, DealCards, CutDeck, SkipCut, Bet, SeeCards, Fold, Show, RequestSideShow, AcceptSideShow, DeclineSideShow
from .side_show import SideShowRequest, SideShowResult, evaluate_side_show_eligibility, previous_seen_player
from .evaluator import FlushHandEvaluator
from .enums import GameStatus, PlayerStatus, Visibility
from .errors import InvalidActionError, InsufficientChipsError
from .events import ActionResult, DomainEvent, ShownHand
from .models import FlushConfig, FlushGameState, PlayerState, RoundResult, Payout, ShowRequest
from .invariants import validate_game_state
from .queries import public_view, player_view, allowed_actions
from .visibility import visible_events
from .settlement import settle
from .turns import (require_turn, next_seat, active_players, required_bet, show_cost,
                    evaluate_see_eligibility, evaluate_show_eligibility, require_eligible)


class FlushGameEngine:
    """One fixed-roster round. get_state() is trusted; views are safe for adapters.

    Rules are frozen at construction; no command changes them. Authentication,
    command receipts, expected-revision checks, and concurrency belong to the host.
    """
    def __init__(self, player_ids, *, initial_chips, rules, rng=None, dealer_id=None):
        if isinstance(player_ids, (str, bytes)):
            raise ValueError('Supply a sequence of player IDs.')
        ids = tuple(player_ids)
        if not ids or any(not isinstance(p, str) or not p.strip() for p in ids):
            raise ValueError('Players must have nonempty string IDs.')
        if not isinstance(initial_chips, Mapping) or set(initial_chips) != set(ids):
            raise ValueError('Supply initial chips mapped to exactly the seated player IDs.')
        config = FlushConfig(ids, tuple(initial_chips[p] for p in ids), rules,
                             ids[0] if dealer_id is None else dealer_id)
        if rng is not None and not isinstance(rng, Random):
            raise ValueError('rng must be a random.Random instance.')
        self._rng = Random()
        if rng is not None:
            self._rng.setstate(rng.getstate())
        self._state = FlushGameState(config, tuple(PlayerState(p, chips) for p, chips in
                                                  zip(ids, config.initial_chips)))
        validate_game_state(self._state)

    def get_state(self):
        return self._state

    def get_public_view(self):
        return public_view(self._state)

    def get_player_view(self, player_id):
        return player_view(self._state, player_id)

    def get_allowed_actions(self, player_id):
        return allowed_actions(self._state, player_id)

    def get_visible_events(self, player_id=None, *, after=0):
        return visible_events(self._state, player_id, after)

    def can_see_cards(self, player_id):
        return evaluate_see_eligibility(self._state, player_id)

    def can_show(self, player_id):
        return evaluate_show_eligibility(self._state, player_id)

    def _commit(self, candidate, specs, rng=None):
        revision = self._state.revision + 1
        events = tuple(DomainEvent(len(self._state.history) + i + 1, revision, kind, **fields)
                       for i, (kind, fields) in enumerate(specs))
        candidate = replace(candidate, revision=revision, history=self._state.history + events)
        validate_game_state(candidate)
        result = ActionResult(revision, events)
        self._state = candidate
        if rng is not None:
            self._rng = rng
        return result

    def start_game(self):
        state = self._state
        if state.status is not GameStatus.WAITING:
            raise InvalidActionError('Game has already started.')
        boot = state.config.rules.boot_amount
        if any(p.chips < boot for p in state.players):
            raise InsufficientChipsError('Every player must afford the boot.')
        candidate = replace(state, status=GameStatus.AWAITING_DEAL,
                            current_seat=state.config.player_ids.index(state.config.dealer_id))
        return self._commit(candidate, [('GAME_STARTED', {}),
            ('TURN_CHANGED', {'player_id': candidate.current_player_id})])

    def start_next_round(self, player_id):
        return self.prepare_next_round(player_id)

    def prepare_next_round(self, player_id, *, player_ids=None, initial_chips=None):
        state = self._state
        if state.status is not GameStatus.FINISHED or (player_ids is None and player_id != state.settlement.winner_ids[0]):
            raise InvalidActionError('Only the previous winner can start the next round.')
        ids = tuple(player_ids) if player_ids is not None else state.config.player_ids
        balances = initial_chips if initial_chips is not None else {p.player_id: p.chips for p in state.players}
        config = FlushConfig(ids, tuple(balances[p] for p in ids), state.config.rules, player_id)
        if any(chips < state.config.rules.boot_amount for chips in config.initial_chips):
            raise InsufficientChipsError('Every player must afford the boot for the next round.')
        candidate = FlushGameState(config, tuple(PlayerState(p, balances[p]) for p in ids),
            status=GameStatus.AWAITING_DEAL, current_seat=config.player_ids.index(player_id),
            revision=state.revision, history=state.history, round_number=state.round_number + 1,
            round_start_revision=state.revision + 1, round_results=state.round_results)
        return self._commit(candidate, [('ROUND_STARTED', {'player_id': player_id}),
            ('TURN_CHANGED', {'player_id': player_id})])

    def deal_cards(self, player_id):
        state = self._state
        if state.status is not GameStatus.AWAITING_DEAL or player_id != state.current_player_id:
            raise InvalidActionError('Only the dealer can start the deal.')
        rng = Random()
        rng.setstate(self._rng.getstate())
        candidate = replace(state, stock=tuple(shuffle(standard_52(), rng=rng)),
                            status=GameStatus.AWAITING_CUT, current_seat=next_seat(state))
        return self._commit(candidate, [('DEAL_REQUESTED', {'player_id': player_id}),
            ('TURN_CHANGED', {'player_id': candidate.current_player_id})], rng)

    def cut_deck(self, player_id, position):
        if type(position) is not int or not 1 <= position < 52:
            raise InvalidActionError('Cut position must be an integer from 1 to 51.')
        return self._complete_deal(player_id, position)

    def skip_cut(self, player_id):
        return self._complete_deal(player_id, None)

    def _complete_deal(self, player_id, position):
        state = self._state
        if state.status is not GameStatus.AWAITING_CUT or player_id != state.current_player_id:
            raise InvalidActionError('Only the player after the dealer can cut or skip.')
        deck = state.stock if position is None else state.stock[position:] + state.stock[:position]
        hands, stock = deal(deck, len(state.players), 3)
        boot = state.config.rules.boot_amount
        first = (state.config.player_ids.index(state.config.dealer_id) + 1) % len(state.players)
        players = list(state.players)
        for offset, cards in enumerate(hands):
            seat = (first + offset) % len(players)
            players[seat] = replace(players[seat], cards=cards, chips=players[seat].chips - boot,
                                    total_contribution=boot)
        candidate = replace(state, players=tuple(players), stock=stock, status=GameStatus.IN_PROGRESS,
                            current_seat=first, current_blind_bet=state.config.rules.initial_blind_bet,
                            current_seen_bet=state.config.rules.initial_blind_bet * state.config.rules.blind_to_seen_bet_multiplier,
                            pot=boot * len(players))
        events = [('CUT_SKIPPED' if position is None else 'DECK_CUT', {'player_id': player_id}),
                  ('CARDS_DEALT', {})]
        if boot:
            events += [('BOOT_COLLECTED', {'player_id': p.player_id, 'amount': boot}) for p in players]
        events.append(('TURN_CHANGED', {'player_id': candidate.current_player_id}))
        return self._commit(candidate, events)

    def _replace_player(self, player):
        return replace(self._state, players=tuple(player if p.player_id == player.player_id else p
                                                  for p in self._state.players))

    def bet(self, player_id, amount):
        state = self._state
        p = require_turn(state, player_id)
        if type(amount) is not int or amount < required_bet(state, p):
            raise InvalidActionError('Bet must be a whole number at least the current minimum.')
        if p.chips < amount:
            raise InsufficientChipsError('Not enough chips to bet; you may fold.')
        candidate = self._replace_player(replace(p, chips=p.chips - amount,
            total_contribution=p.total_contribution + amount, turn_bet_count=p.turn_bet_count + 1,
            blind_bet_count=p.blind_bet_count + int(p.visibility is Visibility.BLIND)))
        multiplier = state.config.rules.blind_to_seen_bet_multiplier
        seen_minimum = amount if p.visibility is Visibility.SEEN else amount * multiplier
        candidate = replace(candidate, pot=state.pot + amount, current_seat=next_seat(candidate),
                            current_seen_bet=seen_minimum,
                            current_blind_bet=(seen_minimum + multiplier - 1) // multiplier)
        return self._commit(candidate, [('BET_PLACED', {'player_id': player_id, 'amount': amount}),
                                       ('TURN_CHANGED', {'player_id': candidate.current_player_id})])

    def see_cards(self, player_id):
        require_eligible(self.can_see_cards(player_id))
        p = require_turn(self._state, player_id)
        return self._commit(self._replace_player(replace(p, visibility=Visibility.SEEN)),
                            [('CARDS_SEEN', {'player_id': player_id})])

    def _finish(self, candidate, events):
        result = candidate.settlement
        ledger = RoundResult(candidate.round_number, result.winner_ids,
            tuple(Payout(p.player_id, p.chips - initial)
                  for p, initial in zip(candidate.players, candidate.config.initial_chips)))
        candidate = replace(candidate, round_results=candidate.round_results + (ledger,))
        return self._commit(candidate, events + [('ROUND_FINISHED', {
            'winner_ids': result.winner_ids, 'amount': candidate.pot, 'shown_hands': result.shown_hands})])

    def fold(self, player_id):
        if self._state.pending_show is not None:
            return self._respond_show(player_id, reveal=False)
        p = require_turn(self._state, player_id)
        candidate = self._replace_player(replace(p, status=PlayerStatus.FOLDED))
        events = [('PLAYER_FOLDED', {'player_id': player_id})]
        if len(active_players(candidate)) == 1:
            return self._finish(settle(candidate), events)
        candidate = replace(candidate, current_seat=next_seat(candidate))
        return self._commit(candidate, events + [('TURN_CHANGED', {'player_id': candidate.current_player_id})])

    def show(self, player_id):
        require_eligible(self.can_show(player_id))
        p = require_turn(self._state, player_id)
        cost = show_cost(self._state, p)
        candidate = self._replace_player(replace(p, chips=p.chips - cost,
                                                total_contribution=p.total_contribution + cost))
        target = next(p for p in active_players(candidate) if p.player_id != player_id)
        shown = (ShownHand(player_id, p.cards),)
        candidate = replace(candidate, pot=candidate.pot + cost,
            pending_show=ShowRequest(player_id, target.player_id), revealed_hands=shown,
            current_seat=candidate.config.player_ids.index(target.player_id))
        return self._commit(candidate, [('SHOW_REQUESTED', {'player_id': player_id,
            'target_player_id': target.player_id, 'amount': cost, 'shown_hands': shown}),
            ('TURN_CHANGED', {'player_id': target.player_id})])

    def reveal_cards(self, player_id):
        return self._respond_show(player_id, reveal=True)

    def _respond_show(self, player_id, *, reveal):
        state = self._state
        request = state.pending_show
        if state.status is not GameStatus.IN_PROGRESS or request is None or request.target_id != player_id:
            raise InvalidActionError('Only the other final player can reveal or fold.')
        candidate = state
        events = []
        if not reveal:
            candidate = replace(state, players=tuple(replace(p, status=PlayerStatus.FOLDED)
                if p.player_id == player_id else p for p in state.players))
            events.append(('PLAYER_FOLDED', {'player_id': player_id}))
        candidate = settle(candidate, request.requester_id if reveal else None)
        return self._finish(candidate, events)

    def can_side_show(self, player_id):
        return evaluate_side_show_eligibility(self._state, player_id)

    def request_side_show(self, player_id):
        require_eligible(self.can_side_show(player_id))
        state = self._state
        p = require_turn(state, player_id)
        target = previous_seen_player(state, player_id)
        amount = required_bet(state, p)
        candidate = self._replace_player(replace(p, chips=p.chips - amount,
            total_contribution=p.total_contribution + amount, turn_bet_count=p.turn_bet_count + 1))
        candidate = replace(candidate, pot=candidate.pot + amount,
            pending_side_show=SideShowRequest(player_id, target.player_id, state.revision + 1),
            current_seat=state.config.player_ids.index(target.player_id))
        return self._commit(candidate, [('SIDE_SHOW_REQUESTED', {'player_id': player_id,
            'target_player_id': target.player_id, 'amount': amount}), ('TURN_CHANGED', {'player_id': target.player_id})])

    def accept_side_show(self, player_id):
        return self._respond_side_show(player_id, accept=True)

    def decline_side_show(self, player_id):
        return self._respond_side_show(player_id, accept=False)

    def _respond_side_show(self, player_id, *, accept):
        state = self._state
        request = state.pending_side_show
        if state.status is not GameStatus.IN_PROGRESS or request is None or request.target_id != player_id:
            raise InvalidActionError('Only the requested player can respond to this side-show.')
        requester = next(p for p in state.players if p.player_id == request.requester_id)
        target = next(p for p in state.players if p.player_id == request.target_id)
        candidate = replace(state, pending_side_show=None,
                            current_seat=state.config.player_ids.index(requester.player_id))
        fields = {'player_id': requester.player_id, 'target_player_id': target.player_id}
        kind = 'SIDE_SHOW_DECLINED'
        if accept:
            comparison = FlushHandEvaluator(state.config.rules.sequence_ace_policy).compare(requester.cards, target.cards)
            winner, loser = (requester, target) if comparison > 0 else (target, requester)
            result = SideShowResult(requester.player_id, target.player_id, winner.player_id, loser.player_id,
                requester.cards, target.cards, state.revision + 1)
            candidate = replace(candidate, side_shows=state.side_shows + (result,),
                players=tuple(replace(p, status=PlayerStatus.FOLDED) if p.player_id == loser.player_id else p for p in state.players))
            fields.update(winner_ids=(winner.player_id,), loser_player_id=loser.player_id)
            kind = 'SIDE_SHOW_RESOLVED'
        candidate = replace(candidate, current_seat=next_seat(candidate))
        return self._commit(candidate, [(kind, fields), ('TURN_CHANGED', {'player_id': candidate.current_player_id})])

    def apply_action(self, player_id, action):
        if type(action) is CutDeck:
            return self.cut_deck(player_id, action.position)
        if type(action) is Bet:
            return self.bet(player_id, action.amount)
        handlers = {RevealCards: self.reveal_cards, StartNextRound: self.start_next_round, DealCards: self.deal_cards, SkipCut: self.skip_cut, SeeCards: self.see_cards, Fold: self.fold, Show: self.show, RequestSideShow: self.request_side_show,
                    AcceptSideShow: self.accept_side_show, DeclineSideShow: self.decline_side_show}
        if type(action) not in handlers:
            raise InvalidActionError('Unknown Flush action.')
        return handlers[type(action)](player_id)
