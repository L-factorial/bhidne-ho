import json

import pytest
from pydantic import ValidationError

from app.adapters.callbreak import parse_player_command, OutboundEvent, RoutedEvent
from app.adapters.callbreak.contracts import (
    COMMAND_SPECS, EVENT_SPECS, CommandName, ControllerAction, EventName,
)


def command(name="PLAY_CARD", payload=None, **extra):
    return {"type": "GAME_COMMAND", "protocol_version": 1, "match_id": "match-1",
            "command_id": "command-1", "expected_revision": 7,
            "deal_number": 1, "attempt": 1, "command": name,
            "payload": {"card": "QH"} if payload is None else payload, **extra}


@pytest.mark.parametrize("name,payload", [
    ("SHUFFLE_DECK", {}), ("CUT_DECK", {"position": 26}), ("SKIP_CUT", {}),
    ("START_DISTRIBUTION", {}), ("ACCEPT_HAND", {}), ("CLAIM_REDEAL", {}),
    ("PLACE_BID", {"amount": 4}), ("PLAY_CARD", {"card": "QH"}),
])
def test_player_command_round_trips(name, payload):
    parsed = parse_player_command(json.dumps(command(name, payload)))
    assert parsed.command.value == name and parsed.payload == payload
    assert parse_player_command(parsed.model_dump_json()) == parsed


@pytest.mark.parametrize("raw", [
    command(player_id=2), command(user_id="forged"), command(room_id="other"),
    command(recipient=2), command(protocol_version=True), command(expected_revision=True),
    command(attempt=0), command(deal_number=6), command(command_id=""),
    command("CUT_DECK", {"position": 0}), command("CUT_DECK", {"position": 52}),
    command("CUT_DECK", {"position": True}), command("PLACE_BID", {"amount": "4"}),
    command("PLACE_BID", {"amount": 4.0}), command("PLACE_BID", {"amount": False}),
    command("PLAY_CARD", {"card": "qh"}), command("PLAY_CARD", {"card": "14S"}),
    command("PLAY_CARD", {"card": "QH", "player_id": 2}),
    command("SHUFFLE_DECK", {"deck": ["AS"]}),
    command("START_DEAL", {}), command("PREPARE_DEAL", {}), command("REDEAL", {}),
])
def test_reject_malformed_spoofed_and_controller_requests(raw):
    with pytest.raises(ValidationError):
        parse_player_command(raw)


def payload_examples():
    bids = [{"player_id": p, "amount": 1} for p in range(1, 5)]
    counts = [{"player_id": p, "tricks_won": 1 if p == 2 else 0} for p in range(1, 5)]
    scores = [{"player_id": p, "score_tenths": -10} for p in range(1, 5)]
    return {
        "DEALER_ASSIGNED": {"dealer_id": 1}, "SHUFFLE_REQUESTED": {"dealer_id": 1},
        "DECK_SHUFFLED": {"dealer_id": 1},
        "CUT_REQUESTED": {"player_id": 2, "deck_size": 52},
        "CUT_COMPLETED": {"cutter_id": 2, "position": None, "skipped": True},
        "DISTRIBUTION_REQUESTED": {"dealer_id": 1},
        "DISTRIBUTION_STARTED": {"dealer_id": 1, "first_recipient_id": 2, "cards_per_player": 13},
        "CARD_DEALT": {"player_id": 2, "card": "QH", "hand_count": 1, "distribution_index": 1},
        "CARD_DISTRIBUTED": {"player_id": 2, "hand_count": 1, "distribution_index": 1},
        "DISTRIBUTION_COMPLETED": {"hand_counts": [{"player_id": p, "hand_count": 13} for p in range(1, 5)], "undealt_count": 0},
        "HAND_REVIEW_REQUESTED": {"player_id": 2, "can_claim_redeal": True, "reasons": ["NO_SPADES"]},
        "HAND_ACCEPTED": {"player_id": 2}, "REDEAL_REQUESTED": {"player_id": 2},
        "REDEAL_ELIGIBLE": {"player_id": 2, "reasons": ["NO_SPADES"]},
        "BIDDING_STARTED": {"first_bidder_id": 2, "bidding_order": [2, 3, 4, 1]},
        "BID_REQUESTED": {"player_id": 2, "minimum": 1, "maximum": 13},
        "BID_PLACED": {"player_id": 2, "amount": 1}, "BIDDING_COMPLETED": {"bids": bids},
        "PLAY_STARTED": {"leader_id": 2, "trick_number": 1},
        "CARD_PLAYED": {"player_id": 2, "card": "QH", "trick_number": 1},
        "TRICK_COMPLETED": {"trick_number": 1, "winner_id": 2, "tricks_won": counts,
                            "plays": [{"player_id": p, "card": c} for p, c in zip([2, 3, 4, 1], ["AH", "2H", "3H", "4H"])]},
        "DEAL_COMPLETED": {"bids": bids, "tricks_won": counts, "scores": scores, "totals": scores},
        "MATCH_COMPLETED": {"totals": scores, "winner_ids": [1, 2, 3, 4]},
        "TURN_CHANGED": {"phase": "BIDDING", "player_id": 2},
    }


def event(name, payload):
    return OutboundEvent(match_id="match-1", deal_number=1, attempt=1,
                         revision=8, index=0, event=name, payload=payload)


def test_catalog_is_exhaustive_and_reports_supported_core_commands():
    assert set(COMMAND_SPECS) == set(CommandName)
    assert set(EVENT_SPECS) == set(EventName) == set(payload_examples())
    assert len(COMMAND_SPECS) == 8 and len(EVENT_SPECS) == 24
    assert sum(s.audience == "unicast" for s in EVENT_SPECS.values()) == 7
    assert {s.engine_command for s in COMMAND_SPECS.values() if s.engine_command} == {
        "AcceptHand", "ClaimRedeal", "PlaceBid", "PlayCard", "ShuffleDeck", "CutDeck", "SkipCut", "StartDistribution"}
    assert not {a.value for a in ControllerAction} & {c.value for c in CommandName}


@pytest.mark.parametrize("name,payload", list(payload_examples().items()))
def test_event_round_trip_and_audience_enforcement(name, payload):
    message = event(name, payload)
    spec = EVENT_SPECS[message.event]
    recipient = payload[spec.recipient_field] if spec.audience == "unicast" else None
    routed = RoutedEvent(message=message, recipient_player_id=recipient)
    assert OutboundEvent.model_validate_json(routed.message.model_dump_json()) == message
    assert "recipient_player_id" not in routed.message.model_dump()
    with pytest.raises(ValidationError):
        RoutedEvent(message=message, recipient_player_id=None if recipient is not None else 1)
    if recipient is not None:
        with pytest.raises(ValidationError):
            RoutedEvent(message=message, recipient_player_id=5 if recipient != 5 else 1)


def test_broadcast_card_receipt_cannot_contain_card_and_claim_cannot_contain_reason():
    for name, extra in [("CARD_DISTRIBUTED", {"card": "QH"}),
                        ("REDEAL_REQUESTED", {"reasons": ["NO_SPADES"]})]:
        with pytest.raises(ValidationError):
            event(name, {**payload_examples()[name], **extra})
    with pytest.raises(ValidationError):
        event("CUT_COMPLETED", {"cutter_id": 2, "skipped": True, "position": 26})
    with pytest.raises(ValidationError):
        event("HAND_REVIEW_REQUESTED", {"player_id": 2, "can_claim_redeal": False, "reasons": ["NO_SPADES"]})
