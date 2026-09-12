import json
from random import Random

import pytest
from pydantic import ValidationError

from app.adapters.marriage import (
    COMMAND_SPECS, EVENT_SPECS, AdapterResult, CommandName, CommandRejected,
    EventName, MarriageAdapter, OutboundEvent, PlayerCommand, RoutedEvent,
    parse_player_command, register_marriage,
)
from app.models.action import ReliableActionCommand
from app.models.game import GameCommand
from app.games.base import GameCommandRejected
from app.runtime.command_runtime import CommandAccessError, CommandRuntime
from app.runtime.game_registry import GameRegistry
from marriage import ActionKind, DrawSource, GameStatus, MarriageGameEngine
from examples.marriage_round import pairs_in


def adapter():
    return MarriageAdapter(MarriageGameEngine(("a", "b"), rng=Random(42)),
                           match_id="match", owner_player_id="a")


def command(game, name, payload=None, *, actor="a", command_id=None):
    return game.dispatch_player(PlayerCommand(match_id="match", expected_revision=game.revision,
        command_id=command_id or f"c-{game.revision}-{name}", command=name, payload=payload or {}), player_id=actor)


def test_catalog_complete_and_strict_parse():
    assert set(COMMAND_SPECS) == set(CommandName)
    assert set(EVENT_SPECS) == set(EventName)
    base = dict(match_id="match", command_id="c", expected_revision=0, command="START_GAME")
    assert parse_player_command(json.dumps(base)).command is CommandName.START_GAME
    for changes in ({"player_id": "b"}, {"recipient": "b"}, {"room_id": "other"},
                    {"protocol_version": True}, {"expected_revision": True},
                    {"command": "SHUFFLE_DECK"}, {"command": "FINISH", "payload": {"winner": "a"}},
                    {"command": "DRAW_CARD", "payload": {"source": "deck"}},
                    {"command": "DISCARD_CARD", "payload": {"card_id": "7H"}},
                    {"command": "SHOW_DUBLEES", "payload": {"pairs": []}}):
        with pytest.raises(ValidationError):
            parse_player_command({**base, **changes})


def test_owner_revision_match_actor_checks_and_private_hands():
    game = adapter()
    assert command(game, "START_GAME", actor="b").code == "OWNER_REQUIRED"
    assert command(game, "START_GAME", actor="outsider").code == "UNKNOWN_PLAYER"
    wrong = PlayerCommand(match_id="other", command_id="c", expected_revision=0, command="START_GAME")
    assert game.dispatch_player(wrong, player_id="a").code == "MATCH_MISMATCH"
    result = command(game, "START_GAME")
    assert isinstance(result, AdapterResult) and result.revision == 1
    public = [e for e in result.messages if e.recipient_player_id is None]
    private = [e for e in result.messages if e.recipient_player_id is not None]
    assert [e.message.event.value for e in public] == ["GAME_STARTED", "TURN_CHANGED"]
    assert {e.recipient_player_id for e in private} == {"a", "b"}
    cards = game.snapshot("a")["view"]["hand"]
    assert len(cards) == 21
    assert not any(c["card_id"] in str([e.model_dump() for e in public]) for c in cards)
    assert private[0].message.payload["view"]["player_id"] == private[0].recipient_player_id
    detached = game.snapshot("a")
    detached["view"]["hand"].clear()
    assert len(game.snapshot("a")["view"]["hand"]) == 21
    stale = PlayerCommand(match_id="match", command_id="stale", expected_revision=0, command="DRAW_CARD",
                          payload={"source": "stock"})
    before = game.checkpoint()
    assert game.dispatch_player(stale, player_id="a").code == "STALE_REVISION"
    assert game.checkpoint() is before
    with pytest.raises(ValidationError):
        RoutedEvent(message=private[0].message)  # A private hand cannot be broadcast.
    with pytest.raises(ValidationError):
        RoutedEvent(message=private[0].message, recipient_player_id="b")


def test_payload_revalidation_and_projection_failure_are_atomic(monkeypatch):
    import app.adapters.marriage.adapter as module
    game = adapter()
    command(game, "START_GAME")
    request = PlayerCommand(match_id="match", command_id="bad", expected_revision=1,
                            command="DRAW_CARD", payload={"source": "stock"})
    request.payload["player_id"] = "b"
    before, rng = game.checkpoint(), game.checkpoint()._rng.getstate()
    with pytest.raises(ValidationError):
        game.dispatch_player(request, player_id="a")

    def fail(**kwargs):
        raise ValueError("projection failed")

    with monkeypatch.context() as patch:
        patch.setattr(module, "OutboundEvent", fail)
        with pytest.raises(ValueError, match="projection failed"):
            command(game, "DRAW_CARD", {"source": "stock"})
    assert game.checkpoint() is before and game.checkpoint()._rng.getstate() == rng
    reference = adapter()
    command(reference, "START_GAME")
    assert command(game, "DRAW_CARD", {"source": "stock"}) == command(reference, "DRAW_CARD", {"source": "stock"})


def test_public_draw_redacted_query_results_private_and_read_only():
    game = adapter()
    command(game, "START_GAME")
    result = command(game, "DRAW_CARD", {"source": "stock"})
    draw = result.messages[0].message
    assert draw.event is EventName.CARD_DRAWN and draw.payload["event"]["card"] is None
    private_card = game.snapshot("a")["view"]["hand"][-1]
    leaked = draw.model_dump(mode="json")
    leaked["payload"]["event"]["card"] = private_card
    with pytest.raises(ValidationError):
        OutboundEvent.model_validate(leaked)
    leaked = draw.model_dump(mode="json")
    leaked["payload"]["event"]["stock"] = [private_card]
    with pytest.raises(ValidationError):
        OutboundEvent.model_validate(leaked)
    queries = ("GET_STATE", "GET_ALLOWED_ACTIONS", "GET_MAAL", "CAN_SEE_MAAL", "READ_LAST_CARD",
               "HAS_EIGHTH_DUBLEE", "CAN_FINISH_NORMAL_HAND", "GET_EVENTS", "GET_SCORES")
    before = game.checkpoint()
    for name in queries:
        response = command(game, name)
        assert len(response.messages) == 1
        event = response.messages[0]
        assert event.recipient_player_id == "a" and event.message.event is EventName.QUERY_RESULT
        assert event.message.payload["command"] == name
        assert game.checkpoint() is before
    history = command(game, "GET_EVENTS", actor="b").messages[0].message.payload["result"]
    assert history[-1]["card"] is None
    history = command(game, "GET_EVENTS").messages[0].message.payload["result"]
    assert history[-1]["card"] == private_card
    assert "stock" not in command(game, "GET_STATE").messages[0].message.payload["result"]


def test_complete_adapter_round_projects_qualification_and_finish():
    game = adapter()
    command(game, "START_GAME")
    observed = set()
    for _ in range(1000):
        state = game.checkpoint()  # Trusted test inspection; all moves use the adapter.
        actor = state.get_public_view().current_player_id
        view = state.get_player_view(actor)
        top = state.read_last_card()
        committed = {i for p in view.public.players if p.player_id == actor for m in p.shown_melds for i in m.card_ids}
        source = "stock"
        if (DrawSource.DISCARD in view.actions.drawable_sources and top.identity is not None
                and sum(c.identity == top.identity and c.card_id not in committed for c in view.hand) == 1):
            source = "discard"
        response = command(game, "DRAW_CARD", {"source": source}, actor=actor)
        assert isinstance(response, AdapterResult)
        pairs = pairs_in(game.checkpoint().get_player_view(actor).hand)
        if ActionKind.SHOW_DUBLEES in game.checkpoint().get_allowed_actions(actor).kinds and len(pairs) >= 7:
            payload = {"pairs": [{"meld_type": "dublee", "card_ids": list(m.card_ids)} for m in pairs[:7]]}
            assert isinstance(command(game, "VALIDATE_DUBLEES", payload, actor=actor), AdapterResult)
            response = command(game, "SHOW_DUBLEES", payload, actor=actor)
            assert isinstance(response, AdapterResult)
            for event in response.messages:
                observed.add(event.message.event)
                if event.message.event is EventName.TIPLU_REVEALED:
                    assert event.message.payload["event"]["card"] is None
                if event.message.event is EventName.PLAYER_STATE:
                    entitled = game.checkpoint().can_see_maal(event.recipient_player_id)
                    assert (event.message.payload["view"]["maal"] is not None) == entitled
        if ActionKind.FINISH in game.checkpoint().get_allowed_actions(actor).kinds:
            response = command(game, "FINISH", actor=actor)
            observed.update(e.message.event for e in response.messages)
            break
        protected = {i for m in pairs for i in m.card_ids}
        choices = game.checkpoint().get_allowed_actions(actor).discardable_card_ids
        card = next((i for i in choices if i not in protected), choices[0])
        assert isinstance(command(game, "DISCARD_CARD", {"card_id": card}, actor=actor), AdapterResult)
    assert game.checkpoint().get_public_view().status is GameStatus.FINISHED
    scores = command(game, "GET_SCORES", actor="b").messages[0].message.payload["result"]
    assert scores == game.snapshot()["view"]["scores"]
    assert scores == game.snapshot("a")["view"]["public"]["scores"]
    assert sum(p["net_points"] for p in scores["players"]) == 0
    assert "hand" not in str(scores)
    assert {EventName.SEVEN_DUBLEES_SHOWN, EventName.TIPLU_REVEALED, EventName.PLAYER_FINISHED} <= observed


def test_normal_meld_commands_and_unsupported_finish_translate_correctly():
    from dataclasses import replace
    from marriage import PlayerState, create_deck, validate_game_state
    engine = MarriageGameEngine(("a", "b"), rng=Random(4))
    engine.start_game()
    engine.draw_card("a", DrawSource.STOCK)
    deck = create_deck()
    groups = tuple(tuple(deck[face + 52 * pack] for pack in range(3)) for face in range(3))
    selected = tuple(c for group in groups for c in group)
    remaining = tuple(c for c in deck if c not in selected)
    engine._state = replace(engine.get_state(), players=(PlayerState("a", selected + remaining[:13]),
                                                       PlayerState("b", remaining[13:34])), stock=remaining[34:])
    validate_game_state(engine.get_state())
    game = MarriageAdapter(engine, match_id="match", owner_player_id="a")
    payload = {"melds": [{"meld_type": "tunnela", "card_ids": [c.card_id for c in group]} for group in groups]}
    for name, data in (("VALIDATE_MELD", {"meld": payload["melds"][0]}),
                       ("VALIDATE_INITIAL_MELDS", payload)):
        result = command(game, name, data)
        assert isinstance(result, AdapterResult) and result.messages[0].recipient_player_id == "a"
    before_revision = game.revision
    result = command(game, "SHOW_INITIAL_MELDS", payload)
    assert result.revision == before_revision + 1
    assert result.messages[0].message.event is EventName.MELDS_SHOWN
    assert command(game, "GET_MAAL").messages[0].message.payload["result"] is not None
    assert command(game, "GET_MAAL", actor="b").messages[0].message.payload["result"] is None
    assert command(game, "FINISH").code == "UNSUPPORTED_RULE"


@pytest.mark.asyncio
async def test_registration_runtime_retry_mapping_authorization_and_rollback(monkeypatch):
    game = adapter()
    registry = GameRegistry()
    target = register_marriage(registry, "room", adapter=game, seat_by_user={"user-a": "a", "user-b": "b"})
    entry = registry.get_room("room")
    assert entry.commands.match_id == "match" and entry.command_target is target
    runtime = CommandRuntime()
    delivered = []

    async def deliver(events):
        delivered.extend(events)

    request = ReliableActionCommand(match_id="match", command_id="start", expected_revision=0,
                                    command="START_GAME")
    response = await runtime.execute(entry.commands, target, "user-a", request, deliver)
    assert response["action_ack"]["status"] == "accepted"
    assert {e.recipient for e in delivered} == {None, "user-a", "user-b"}
    count = len(delivered)
    repeat = await runtime.execute(entry.commands, target, "user-a", request, deliver)
    assert repeat["action_ack"] == response["action_ack"] and len(delivered) == count
    with pytest.raises(CommandAccessError):
        await runtime.execute(entry.commands, target, "outsider", request, deliver)
    before = game.checkpoint()
    draw = ReliableActionCommand(match_id="match", command_id="draw", expected_revision=1,
                                 command="DRAW_CARD", payload={"source": "stock"})
    original = target.apply

    def fail_after_apply(user, request):
        original(user, request)
        raise RuntimeError("simulated failure before delivery")

    with monkeypatch.context() as patch:
        patch.setattr(target, "apply", fail_after_apply)
        with pytest.raises(RuntimeError):
            await runtime.execute(entry.commands, target, "user-a", draw, deliver)
    assert game.checkpoint() is before and len(delivered) == count
    assert ("user-a", "draw") not in entry.commands.receipts
    with pytest.raises(GameCommandRejected, match="reliable"):
        target.handle_command("user-a", GameCommand(command="START_GAME"))
    with pytest.raises(ValueError):
        register_marriage(registry, "room2", adapter=game, seat_by_user={"user-a": "a", "user-b": "b"})


@pytest.mark.asyncio
async def test_delivery_failure_commits_once_and_retry_does_not_redeliver():
    registry = GameRegistry()
    game = adapter()
    target = register_marriage(registry, "room", adapter=game, seat_by_user={"u1": "a", "u2": "b"})
    session = registry.get_room("room").commands
    runtime = CommandRuntime()
    request = ReliableActionCommand(match_id="match", command_id="once", expected_revision=0,
                                    command="START_GAME")

    async def fail(events):
        raise RuntimeError("delivery failed after commit")

    with pytest.raises(RuntimeError):
        await runtime.execute(session, target, "u1", request, fail)
    assert target.revision == 1
    result = await runtime.execute(session, target, "u1", request, fail)
    assert result["action_ack"]["status"] == "accepted" and target.revision == 1
