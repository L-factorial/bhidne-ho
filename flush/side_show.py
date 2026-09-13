"""Private two-player comparison within a continuing round."""
from dataclasses import dataclass
from card_utils import Card
from .enums import PlayerStatus, Visibility
from .turns import require_turn, active_players, required_bet, Eligibility
from .errors import InvalidActionError, InvalidTurnError, InsufficientChipsError


@dataclass(frozen=True)
class SideShowRequest:
    requester_id: str
    target_id: str
    revision: int


@dataclass(frozen=True)
class SideShowResult:
    requester_id: str
    target_id: str
    winner_id: str
    loser_id: str
    requester_cards: tuple[Card, ...]
    target_cards: tuple[Card, ...]
    revision: int

    def __post_init__(self):
        object.__setattr__(self, 'requester_cards', tuple(self.requester_cards))
        object.__setattr__(self, 'target_cards', tuple(self.target_cards))


@dataclass(frozen=True)
class PrivateSideShow:
    opponent_id: str
    opponent_cards: tuple[str, ...]
    won: bool
    revision: int


def previous_seen_player(state, player_id):
    ids = state.config.player_ids
    index = ids.index(player_id)
    for offset in range(1, len(ids)):
        p = state.players[(index - offset) % len(ids)]
        if p.status is PlayerStatus.ACTIVE and p.visibility is Visibility.SEEN:
            return p
    return None


def evaluate_side_show_eligibility(state, player_id):
    try:
        p = require_turn(state, player_id)
        if not state.config.rules.allow_side_show:
            raise InvalidActionError('Side-show is disabled.')
        if p.visibility is not Visibility.SEEN:
            raise InvalidActionError('See your cards before requesting side-show.')
        if p.turn_bet_count < state.config.rules.minimum_bet_rounds_before_side_show:
            raise InvalidActionError('Complete the required personal bets before requesting side-show.')
        if len(active_players(state)) < 3:
            raise InvalidActionError('Use Show when only two players remain.')
        if previous_seen_player(state, player_id) is None:
            raise InvalidActionError('No previous active seen player is available.')
        if p.chips < required_bet(state, p):
            raise InsufficientChipsError('Not enough chips for the side-show bet.')
        return Eligibility(True)
    except (InvalidActionError, InvalidTurnError, InsufficientChipsError) as error:
        return Eligibility(False, str(error), error.code)


def private_side_show(state, player_id):
    for result in reversed(state.side_shows):
        if player_id in (result.requester_id, result.target_id):
            requester = player_id == result.requester_id
            return PrivateSideShow(result.target_id if requester else result.requester_id,
                tuple(str(c) for c in (result.target_cards if requester else result.requester_cards)),
                result.winner_id == player_id, result.revision)
    return None
