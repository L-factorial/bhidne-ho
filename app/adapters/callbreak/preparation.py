"""Increment 2: preparation dispatch and notifications, with trusted local actors.

The host authenticates/maps actor IDs and serializes calls for one match. This
module does not send messages, generate randomness or implement network retries.
"""

from dataclasses import dataclass

from callbreak import (
    CompleteShuffle, CutDeck, MatchState, PlayRejection, PrepareDeal, ShuffleDeck,
    SkipCut, Transition, apply_control, apply_player,
)
from callbreak.config import advance

from .contracts import CommandName, OutboundEvent, PlayerCommand, RoutedEvent


@dataclass(frozen=True)
class PreparationResult:
    state: MatchState
    messages: tuple[RoutedEvent, ...]


def _translate(match_id: str, result: Transition) -> PreparationResult:
    state = result.state
    prep = state.preparation
    assert prep is not None
    messages = []

    def emit(name, payload, recipient=None):
        message = OutboundEvent(match_id=match_id, deal_number=prep.number, attempt=prep.attempt,
                                revision=state.revision, index=len(messages), event=name, payload=payload)
        messages.append(RoutedEvent(message=message, recipient_player_id=recipient))

    for event in result.events:
        data = dict(event.data)
        if event.name == "DealerAssigned":
            emit("DEALER_ASSIGNED", data)
            emit("SHUFFLE_REQUESTED", data, prep.dealer)
        elif event.name == "DeckShuffled":
            emit("DECK_SHUFFLED", data)
            cutter = advance(prep.dealer, state.config.player_count)
            emit("CUT_REQUESTED", {"player_id": cutter, "deck_size": 52}, cutter)
        elif event.name == "CutCompleted":
            emit("CUT_COMPLETED", data)
            emit("DISTRIBUTION_REQUESTED", {"dealer_id": prep.dealer}, prep.dealer)
        elif event.name == "TurnChanged":
            emit("TURN_CHANGED", {"phase": data["phase"], "player_id": data["player"]})
        elif event.name != "ShuffleInitiated":
            raise ValueError(f"Unsupported preparation outcome: {event.name}")
    return PreparationResult(state, tuple(messages))


def dispatch_preparation(
    state: MatchState, request: PlayerCommand, *, match_id: str, player_id: int,
) -> PreparationResult | PlayRejection:
    """match_id and player_id come from host context, never request identity fields."""
    # Revalidate at dispatch, including objects whose mutable payload was changed.
    request = PlayerCommand.model_validate(request.model_dump(mode="json"))
    if request.match_id != match_id:
        return PlayRejection("MATCH_MISMATCH", "Request belongs to another match.")
    if request.expected_revision != state.revision:
        return PlayRejection("STALE_REVISION", "Refresh game state before retrying.")
    prep = state.preparation
    if prep is None:
        return PlayRejection("INVALID_PHASE", "No deal preparation is active.")
    if request.deal_number != prep.number or request.attempt != prep.attempt:
        return PlayRejection("STALE_DEAL", "Request belongs to another deal attempt.")
    if request.command == CommandName.SHUFFLE_DECK:
        command = ShuffleDeck()
    elif request.command == CommandName.CUT_DECK:
        command = CutDeck(request.payload["position"])
    elif request.command == CommandName.SKIP_CUT:
        command = SkipCut()
    else:
        return PlayRejection("UNSUPPORTED_COMMAND", "This increment handles shuffle and cut commands only.")
    result = apply_player(state, player_id, command)
    return _translate(match_id, result) if isinstance(result, Transition) else result


def control_preparation(
    state: MatchState, command: PrepareDeal | CompleteShuffle, *, match_id: str,
) -> PreparationResult | PlayRejection:
    """Trusted host entry point; CompleteShuffle supplies an explicit shuffled deck."""
    if type(command) not in (PrepareDeal, CompleteShuffle):
        return PlayRejection("UNSUPPORTED_COMMAND", "Unknown preparation controller command.")
    result = apply_control(state, command)
    return _translate(match_id, result) if isinstance(result, Transition) else result
