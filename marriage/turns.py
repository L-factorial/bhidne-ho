"""Shared turn eligibility and pile rules; no platform command envelopes."""
from random import Random

from .cards import PhysicalCard
from .completion import winning_discard
from .enums import DrawSource, GameStatus, QualificationRoute, TurnPhase
from .errors import InvalidActionError
from .models import MarriageGameState, PlayerState


def find_player(state: MarriageGameState, player_id: str) -> PlayerState:
    for player in state.players:
        if player.player_id == player_id:
            return player
    raise InvalidActionError("Unknown player ID.")


def turn_block(state: MarriageGameState, player_id: str) -> str | None:
    if state.status is not GameStatus.IN_PROGRESS:
        return "Game is not in progress."
    if state.current_player_id != player_id:
        return "It is another player's turn."
    if state.must_finish:
        return "Player must finish the round."
    return None


def draw_source_block(state: MarriageGameState, player: PlayerState, source: DrawSource) -> str | None:
    """Caller checks actor and phase first. Shared by queries and command validation."""
    if source is DrawSource.STOCK:
        if not state.stock and len(state.discard) < 2:
            return "No stock cards or recyclable discards remain."
    elif source is DrawSource.DISCARD:
        if not state.discard:
            return "Discard pile is empty."
        if player.route is QualificationRoute.DUBLEE and not state.config.rules.dublee_player_can_draw_discard:
            if not state.config.rules.dublee_player_can_take_winning_discard:
                return "Dublee players cannot draw from the discard pile."
            if not winning_discard(player, state.discard[-1]):
                return "Discard must complete an uncommitted eighth Dublee."
    return None


def discardable_ids(state: MarriageGameState, player: PlayerState) -> tuple[str, ...]:
    if turn_block(state, player.player_id) or state.phase is not TurnPhase.MUST_DISCARD:
        return ()
    return tuple(card.card_id for card in player.hand if card.card_id not in player.committed_card_ids)


def recycle_discards(discard: tuple[PhysicalCard, ...], rng: Random
                     ) -> tuple[tuple[PhysicalCard, ...], tuple[PhysicalCard, ...]]:
    """Internal helper, called only for an empty stock with at least two discards."""
    recyclable = list(discard[:-1])
    rng.shuffle(recyclable)
    return tuple(recyclable), discard[-1:]
