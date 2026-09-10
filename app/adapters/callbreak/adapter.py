"""Complete game dispatch and event translation, with trusted local actors.

The host authenticates/maps actor IDs and serializes calls for one match. This
module does not send messages, generate randomness or implement network retries.
"""

from dataclasses import dataclass

from callbreak import (
    CompleteShuffle, CutDeck, MatchState, PlayRejection, PrepareDeal, ShuffleDeck,
    SkipCut, Transition, apply_control, apply_player, AcceptHand, ClaimRedeal,
    PlaceBid, PlayCard, StartDistribution, Phase,
)
from callbreak.config import advance
from callbreak.house_rules import redeal_reasons
from card_utils import Card

from .contracts import CommandName, OutboundEvent, PlayerCommand, RoutedEvent


@dataclass(frozen=True)
class AdapterResult:
    state: MatchState
    messages: tuple[RoutedEvent, ...]


def _context(state):
    return state.preparation or state.current_deal or (state.completed_deals[-1].deal if state.completed_deals else None)


def _translate(match_id: str, result: Transition) -> AdapterResult:
    state = result.state
    prep = _context(state)
    assert prep is not None
    messages = []

    def emit(name, payload, recipient=None):
        message = OutboundEvent(match_id=match_id, deal_number=prep.number, attempt=prep.attempt,
                                revision=state.revision, index=len(messages), event=name, payload=payload)
        messages.append(RoutedEvent(message=message, recipient_player_id=recipient))

    def rows(values, field):
        return [{"player_id": i + 1, field: value} for i, value in enumerate(values)]

    def bidding_started():
        first = advance(prep.dealer, state.config.player_count)
        emit("BIDDING_STARTED", {"first_bidder_id": first,
             "bidding_order": [advance(first, state.config.player_count, i) for i in range(state.config.player_count)]})

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
        elif event.name == "DistributionStarted":
            emit("DISTRIBUTION_STARTED", data)
        elif event.name == "CardDealt":
            emit("CARD_DEALT", {**data, "card": str(data["card"])}, event.recipient)
        elif event.name == "CardDistributed":
            emit("CARD_DISTRIBUTED", data)
        elif event.name == "DistributionCompleted":
            emit("DISTRIBUTION_COMPLETED", {"hand_counts": rows(data["hand_counts"], "hand_count"),
                                           "undealt_count": data["undealt_count"]})
            if state.phase == Phase.HAND_REVIEW:
                for player in state.current_deal.players:
                    reasons = list(redeal_reasons(player.hand, state.config.redeal_policy))
                    emit("HAND_REVIEW_REQUESTED", {"player_id": player.player_id,
                         "can_claim_redeal": bool(reasons), "reasons": reasons}, player.player_id)
                emit("TURN_CHANGED", {"phase": state.phase.value, "player_id": None})
            else:
                bidding_started()
        elif event.name == "HandAccepted":
            emit("HAND_ACCEPTED", {"player_id": data["player"]})
            if state.phase == Phase.BIDDING:
                bidding_started()
        elif event.name == "RedealRequested":
            emit("REDEAL_REQUESTED", {"player_id": data["player"]})
        elif event.name == "RedealEligible":
            emit("REDEAL_ELIGIBLE", {"player_id": event.recipient, "reasons": list(data["reasons"])}, event.recipient)
            emit("TURN_CHANGED", {"phase": state.phase.value, "player_id": None})
        elif event.name == "BidPlaced":
            emit("BID_PLACED", {"player_id": data["player"], "amount": data["bid"]})
        elif event.name == "PlayStarted":
            emit("BIDDING_COMPLETED", {"bids": rows(tuple(p.bid for p in state.current_deal.players), "amount")})
            emit("PLAY_STARTED", {"leader_id": data["leader"], "trick_number": 1})
        elif event.name == "CardPlayed":
            emit("CARD_PLAYED", {"player_id": data["player"], "card": str(data["card"]), "trick_number": data["trick"]})
        elif event.name == "TrickCompleted":
            emit("TRICK_COMPLETED", {"trick_number": data["trick"], "winner_id": data["winner"],
                 "plays": [{"player_id": p.player_id, "card": str(p.card)} for p in data["plays"]],
                 "tricks_won": rows(data["tricks_won"], "tricks_won")})
        elif event.name == "DealCompleted":
            scores = data["result"]
            emit("DEAL_COMPLETED", {"bids": rows(scores.bids, "amount"),
                 "tricks_won": rows(scores.tricks_won, "tricks_won"),
                 "scores": rows(scores.score_tenths, "score_tenths"), "totals": rows(data["totals"], "score_tenths")})
        elif event.name == "MatchCompleted":
            emit("MATCH_COMPLETED", {"totals": rows(data["totals"], "score_tenths"), "winner_ids": list(data["winners"])})
        elif event.name == "TurnChanged":
            emit("TURN_CHANGED", {"phase": data["phase"], "player_id": data["player"]})
            if state.phase == Phase.BIDDING:
                emit("BID_REQUESTED", {"player_id": state.current_player, "minimum": 1,
                     "maximum": state.config.tricks_per_deal}, state.current_player)
        elif event.name != "ShuffleInitiated":
            raise ValueError(f"Unsupported domain outcome: {event.name}")
    if state.phase in (Phase.DEAL_COMPLETE, Phase.MATCH_COMPLETE):
        emit("TURN_CHANGED", {"phase": state.phase.value, "player_id": None})
    return AdapterResult(state, tuple(messages))


def dispatch_player(
    state: MatchState, request: PlayerCommand, *, match_id: str, player_id: int,
) -> AdapterResult | PlayRejection:
    """match_id and player_id come from host context, never request identity fields."""
    # Revalidate at dispatch, including objects whose mutable payload was changed.
    request = PlayerCommand.model_validate(request.model_dump(mode="json"))
    if request.match_id != match_id:
        return PlayRejection("MATCH_MISMATCH", "Request belongs to another match.")
    if request.expected_revision != state.revision:
        return PlayRejection("STALE_REVISION", "Refresh game state before retrying.")
    prep = _context(state)
    if prep is None:
        return PlayRejection("INVALID_PHASE", "No deal is active.")
    if request.deal_number != prep.number or request.attempt != prep.attempt:
        return PlayRejection("STALE_DEAL", "Request belongs to another deal attempt.")
    if request.command == CommandName.SHUFFLE_DECK:
        command = ShuffleDeck()
    elif request.command == CommandName.CUT_DECK:
        command = CutDeck(request.payload["position"])
    elif request.command == CommandName.SKIP_CUT:
        command = SkipCut()
    elif request.command == CommandName.START_DISTRIBUTION:
        command = StartDistribution()
    elif request.command == CommandName.ACCEPT_HAND:
        command = AcceptHand()
    elif request.command == CommandName.CLAIM_REDEAL:
        command = ClaimRedeal()
    elif request.command == CommandName.PLACE_BID:
        command = PlaceBid(request.payload["amount"])
    elif request.command == CommandName.PLAY_CARD:
        command = PlayCard(Card.parse(request.payload["card"]))
    else:
        return PlayRejection("UNSUPPORTED_COMMAND", "Unknown game command.")
    result = apply_player(state, player_id, command)
    return _translate(match_id, result) if isinstance(result, Transition) else result


def dispatch_control(
    state: MatchState, command: PrepareDeal | CompleteShuffle, *, match_id: str,
) -> AdapterResult | PlayRejection:
    """Trusted host entry point; CompleteShuffle supplies an explicit shuffled deck."""
    if type(command) not in (PrepareDeal, CompleteShuffle):
        return PlayRejection("UNSUPPORTED_COMMAND", "Unknown preparation controller command.")
    result = apply_control(state, command)
    return _translate(match_id, result) if isinstance(result, Transition) else result
