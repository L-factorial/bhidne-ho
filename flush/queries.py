"""Explicit safe projections. Never serialize authoritative state to a client."""
from dataclasses import dataclass, asdict
from .enums import GameStatus, PlayerStatus, Visibility
from .rules import FlushRulesConfig
from .models import RoundSettlement, RoundResult, ShowRequest
from .events import ShownHand
from .side_show import SideShowRequest, PrivateSideShow, private_side_show, evaluate_side_show_eligibility, previous_seen_player
from .turns import (find_player, required_bet, show_cost, evaluate_see_eligibility,
                    evaluate_show_eligibility, Eligibility)


@dataclass(frozen=True)
class AllowedActions:
    kinds: tuple[str, ...]
    required_bet: int
    show_cost: int
    see: Eligibility
    show: Eligibility
    side_show: Eligibility
    side_show_target_id: str | None


@dataclass(frozen=True)
class PublicPlayerView:
    player_id: str
    status: PlayerStatus
    visibility: Visibility
    card_count: int
    chips: int
    total_contribution: int
    blind_bet_count: int
    turn_bet_count: int


@dataclass(frozen=True)
class PublicGameView:
    status: GameStatus
    revision: int
    rules: FlushRulesConfig
    ruleset_id: str
    rules_locked: bool
    players: tuple[PublicPlayerView, ...]
    dealer_id: str
    current_player_id: str | None
    current_blind_bet: int
    current_seen_bet: int
    pot: int
    held_pot: int
    settlement: RoundSettlement | None
    pending_side_show: SideShowRequest | None
    round_number: int
    round_results: tuple[RoundResult, ...]
    next_dealer_id: str | None
    pending_show: ShowRequest | None
    revealed_hands: tuple[ShownHand, ...]

    def to_dict(self):
        result = asdict(self)
        if self.settlement:
            result['settlement']['shown_hands'] = [
                {'player_id': hand.player_id, 'cards': [str(c) for c in hand.cards]}
                for hand in self.settlement.shown_hands]
        return result


@dataclass(frozen=True)
class PlayerView:
    player_id: str
    public: PublicGameView
    cards: tuple[str, ...]
    actions: AllowedActions
    side_show: PrivateSideShow | None

    def to_dict(self):
        return {'player_id': self.player_id, 'public': self.public.to_dict(),
                'cards': list(self.cards), 'actions': asdict(self.actions), 'side_show': asdict(self.side_show) if self.side_show else None}


def allowed_actions(state, player_id):
    player = find_player(state, player_id)
    see = evaluate_see_eligibility(state, player_id)
    show = evaluate_show_eligibility(state, player_id)
    side_show = evaluate_side_show_eligibility(state, player_id)
    target = previous_seen_player(state, player_id)
    kinds = []
    if (state.status is GameStatus.FINISHED and player_id == state.settlement.winner_ids[0]
            and all(p.chips >= state.config.rules.boot_amount for p in state.players)):
        kinds.append('start_next_round')
    if state.current_player_id == player_id:
        if state.status is GameStatus.AWAITING_DEAL:
            kinds.append('deal_cards')
        elif state.status is GameStatus.AWAITING_CUT:
            kinds.extend(('cut_deck', 'skip_cut'))
    if (state.status is GameStatus.IN_PROGRESS and player.status is PlayerStatus.ACTIVE
            and state.current_player_id == player_id and state.pending_side_show is None and state.pending_show is None):
        kinds.append('fold')
        if player.chips >= required_bet(state, player):
            kinds.append('bet')
        if see.allowed:
            kinds.append('see_cards')
        if show.allowed:
            kinds.append('show')
        if side_show.allowed:
            kinds.append('request_side_show')
    if state.status is GameStatus.IN_PROGRESS and state.pending_side_show and state.pending_side_show.target_id == player_id:
        kinds.extend(('accept_side_show', 'decline_side_show'))
    if state.pending_show and state.pending_show.target_id == player_id:
        kinds.extend(('reveal_cards', 'fold'))
    return AllowedActions(tuple(kinds), required_bet(state, player), show_cost(state, player), see, show, side_show, target.player_id if side_show.allowed else None)


def public_view(state):
    return PublicGameView(state.status, state.revision, state.config.rules, state.config.rules.ruleset_id,
                          state.status is not GameStatus.WAITING,
                          tuple(PublicPlayerView(p.player_id, p.status, p.visibility, len(p.cards), p.chips,
                                p.total_contribution, p.blind_bet_count, p.turn_bet_count) for p in state.players),
                          state.config.dealer_id, state.current_player_id, state.current_blind_bet, state.current_seen_bet,
                          state.pot, state.held_pot, state.settlement, state.pending_side_show, state.round_number, state.round_results,
                          state.settlement.winner_ids[0] if state.settlement else None, state.pending_show, state.revealed_hands)


def player_view(state, player_id):
    p = find_player(state, player_id)
    return PlayerView(player_id, public_view(state),
                      tuple(str(c) for c in p.cards) if p.visibility is Visibility.SEEN else (),
                      allowed_actions(state, player_id), private_side_show(state, player_id))
