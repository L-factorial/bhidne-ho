from dataclasses import dataclass
from .enums import GameStatus, PlayerStatus, Visibility
from .errors import InvalidActionError, InvalidTurnError


def find_player(state, player_id):
    for player in state.players:
        if player.player_id == player_id:
            return player
    raise InvalidActionError('Unknown player.')


def active_players(state):
    return tuple(p for p in state.players if p.status is PlayerStatus.ACTIVE)


def next_seat(state):
    for offset in range(1, len(state.players) + 1):
        seat = (state.current_seat + offset) % len(state.players)
        if state.players[seat].status is PlayerStatus.ACTIVE:
            return seat
    raise InvalidActionError('No active player remains.')


def require_turn(state, player_id):
    player = find_player(state, player_id)
    if state.status is not GameStatus.IN_PROGRESS:
        raise InvalidActionError('Game is not in progress.')
    if state.pending_show is not None:
        raise InvalidActionError('Waiting for the final player to reveal or fold.')
    if state.pending_side_show is not None:
        raise InvalidActionError('Waiting for the side-show response.')
    if player.status is not PlayerStatus.ACTIVE:
        raise InvalidActionError('Player is not active.')
    if state.current_player_id != player_id:
        raise InvalidTurnError('It is another player’s turn.')
    return player


@dataclass(frozen=True)
class Eligibility:
    allowed: bool
    reason: str | None = None
    code: str | None = None


def required_bet(state, player):
    return state.current_seen_bet if player.visibility is Visibility.SEEN else state.current_blind_bet


def show_cost(state, player):
    return required_bet(state, player) * state.config.rules.show_cost_multiplier


def evaluate_see_eligibility(state, player_id):
    try:
        player = find_player(state, player_id)
        if state.status is not GameStatus.IN_PROGRESS or player.status is not PlayerStatus.ACTIVE:
            raise InvalidActionError('Player cannot see cards outside an active hand.')
        if player.visibility is Visibility.SEEN:
            raise InvalidActionError('Cards have already been seen.')
        return Eligibility(True)
    except (InvalidActionError, InvalidTurnError) as error:
        return Eligibility(False, str(error), error.code)


def evaluate_show_eligibility(state, player_id):
    try:
        player = require_turn(state, player_id)
        rules = state.config.rules
        count = len(active_players(state))
        multiplayer = count > 2 and player.visibility is Visibility.BLIND and rules.allow_multiplayer_blind_show
        if count != 2 and not multiplayer:
            raise InvalidActionError('Show requires exactly two active players.')
        if multiplayer and min(p.turn_bet_count for p in active_players(state)) < rules.minimum_rounds_before_multiplayer_blind_show:
            raise InvalidActionError('Complete the required betting cycles before blind show.')
        if rules.require_minimum_bets_by_everyone and any(
                p.turn_bet_count < rules.minimum_bets_before_show for p in active_players(state)):
            raise InvalidActionError('Every remaining player must complete the required minimum bets before showing.')
        if player.visibility is Visibility.BLIND:
            if not rules.allow_blind_show:
                raise InvalidActionError('Blind show is disabled.')
            if not multiplayer and player.blind_bet_count < rules.minimum_blind_rounds_before_show:
                raise InvalidActionError('Complete the required personal blind bets before showing.')
            if not multiplayer and count > rules.maximum_active_players_for_blind_show:
                raise InvalidActionError('Too many active players for blind show.')
        elif not rules.allow_seen_show:
            raise InvalidActionError('Seen show is disabled.')
        return Eligibility(True)
    except (InvalidActionError, InvalidTurnError) as error:
        return Eligibility(False, str(error), error.code)


def require_eligible(result):
    if not result.allowed:
        error = {'INVALID_TURN': InvalidTurnError}.get(
            result.code, InvalidActionError)
        raise error(result.reason)


def raises_used(state):
    """Count table-wide doubles in the current hand from durable public events."""
    blind = state.config.rules.initial_blind_bet
    multiplier = state.config.rules.blind_to_seen_bet_multiplier
    seen = blind * multiplier
    visible = set()
    count = 0
    events = []
    for event in reversed(state.history):
        if event.revision < state.round_start_revision:
            break
        events.append(event)
    for event in reversed(events):
        if event.kind == 'CARDS_SEEN':
            visible.add(event.player_id)
        elif event.kind == 'BET_PLACED':
            minimum = seen if event.player_id in visible else blind
            if event.amount > minimum:
                count += 1
            seen = event.amount if event.player_id in visible else event.amount * multiplier
            blind = (seen + multiplier - 1) // multiplier
    return count


def maximum_bet(state, player):
    minimum = required_bet(state, player)
    can_raise = state.config.rules.allow_raise and raises_used(state) < state.config.rules.max_raise
    return minimum * (2 if can_raise else 1)
