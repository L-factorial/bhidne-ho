import asyncio
from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest

from app.durable_games.models import CanonicalGameEvent, ProposedGameEvent
from app.durable_games.replay import GameJournalError, replay
from app.durable_games.runtime import DurableCommandRuntime
from app.durable_games.store import (
    DurableGameConflict,
    InMemoryGameStore,
    StaleGameOwner,
)
from app.games.echo import DurableEchoGame, EchoState
from app.models.action import ReliableActionCommand
from app.runtime.command_runtime import OutgoingEvent


def committed(proposed):
    return CanonicalGameEvent(event_id=uuid4(), **proposed.model_dump())


def test_echo_initial_state_and_events_reconstruct_exact_state():
    game = DurableEchoGame()
    initial = game.encode_state(game.initial_state())
    state = game.decode_state(initial)
    journal = []

    for sequence, (actor, message) in enumerate((("user-a", "one"), ("user-b", "two")), 1):
        proposed = game.decide(state, actor, "PING", {"message": message})
        assert len(proposed) == 1
        event = committed(proposed[0])
        state = game.reduce(state, event)
        journal.append((sequence, event))

    assert state == EchoState(2)
    assert replay(game, initial, journal) == state
    assert replay(game, initial, journal) == replay(game, initial, journal)


def test_replay_rejects_sequence_gaps_and_invalid_event_progression():
    game = DurableEchoGame()
    initial = game.encode_state(game.initial_state())
    event = committed(game.decide(game.initial_state(), "user-a", "PING", {})[0])

    with pytest.raises(GameJournalError):
        replay(game, initial, [(2, event)])

    invalid = event.model_copy(update={"payload": {**event.payload, "command_count": 2}})
    with pytest.raises(ValueError):
        replay(game, initial, [(1, invalid)])


def test_echo_decision_does_not_mutate_state():
    game = DurableEchoGame()
    state = game.initial_state()
    first = game.decide(state, "user-a", "PING", {"message": "same"})
    second = game.decide(state, "user-a", "PING", {"message": "same"})

    assert first == second
    assert state == EchoState()


async def test_store_creates_appends_replays_and_deduplicates_commands():
    store, definition, game_id = InMemoryGameStore(), DurableEchoGame(), uuid4()
    created = await store.create(game_id, "room", definition)
    ownership = await store.acquire(game_id, "server-a")
    assert created.state == EchoState() and created.sequence == created.revision == 0

    first = await store.execute(game_id, definition, actor_id="user-a", command_id="command-1",
        expected_revision=0, command="PING", payload={"message": "hello"}, ownership=ownership)
    assert first.receipt.status == "accepted"
    assert first.receipt.first_sequence == first.receipt.last_sequence == 1
    assert first.game.state == EchoState(1)
    assert first.events[0].event.payload["message"] == "hello"

    retried = await store.execute(game_id, definition, actor_id="user-a", command_id="command-1",
        expected_revision=0, command="PING", payload={"message": "hello"}, ownership=ownership)
    assert retried.duplicate and retried.events == ()
    assert retried.receipt == first.receipt
    assert (await store.load(game_id, definition)).state == EchoState(1)


async def test_store_persists_rejections_and_detects_command_id_conflicts():
    store, definition, game_id = InMemoryGameStore(), DurableEchoGame(), uuid4()
    await store.create(game_id, "room", definition)
    ownership = await store.acquire(game_id, "server-a")

    rejected = await store.execute(game_id, definition, actor_id="user-a", command_id="bad",
        expected_revision=0, command="UNKNOWN", payload={}, ownership=ownership)
    assert rejected.receipt.status == "rejected"
    assert rejected.receipt.rejection_code == "UNKNOWN_COMMAND"
    assert rejected.game.sequence == rejected.game.revision == 0
    assert (await store.execute(game_id, definition, actor_id="user-a", command_id="bad",
        expected_revision=0, command="UNKNOWN", payload={}, ownership=ownership)).duplicate

    with pytest.raises(DurableGameConflict):
        await store.execute(game_id, definition, actor_id="user-a", command_id="bad",
            expected_revision=0, command="PING", payload={}, ownership=ownership)


async def test_concurrent_commands_serialize_and_only_one_advances_stale_revision():
    store, definition, game_id = InMemoryGameStore(), DurableEchoGame(), uuid4()
    await store.create(game_id, "room", definition)
    ownership = await store.acquire(game_id, "server-a")

    results = await asyncio.gather(*(store.execute(
        game_id, definition, actor_id=f"user-{index}", command_id=f"command-{index}",
        expected_revision=0, command="PING", payload={"message": str(index)}, ownership=ownership,
    ) for index in range(2)))

    assert sorted(result.receipt.status for result in results) == ["accepted", "rejected"]
    rejected = next(result for result in results if result.receipt.status == "rejected")
    assert rejected.receipt.rejection_code == "STALE_REVISION"
    loaded = await store.load(game_id, definition)
    assert loaded.sequence == loaded.revision == 1 and loaded.state == EchoState(1)


async def test_store_enforces_ownership_epoch_and_idempotent_game_creation():
    store, definition, game_id = InMemoryGameStore(), DurableEchoGame(), uuid4()
    first = await store.create(game_id, "room", definition)
    assert await store.create(game_id, "room", definition) == first
    ownership = await store.acquire(game_id, "server-a")

    with pytest.raises(StaleGameOwner):
        await store.execute(game_id, definition, actor_id="user-a", command_id="command",
            expected_revision=0, command="PING", payload={},
            ownership=ownership.__class__(game_id, "server-a", ownership.epoch + 1,
                                          ownership.fencing_token, ownership.lease_expires_at))


async def test_lease_renews_then_expired_owner_is_fenced_after_takeover():
    store, definition, game_id = InMemoryGameStore(), DurableEchoGame(), uuid4()
    await store.create(game_id, "room", definition)
    first = await store.acquire(game_id, "server-a")

    with pytest.raises(DurableGameConflict):
        await store.acquire(game_id, "server-b")

    renewed = await store.renew(first, 60)
    assert renewed.epoch == first.epoch and renewed.fencing_token == first.fencing_token
    assert renewed.lease_expires_at > first.lease_expires_at

    store.games[game_id].lease_expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
    second = await store.acquire(game_id, "server-b")
    assert second.epoch == first.epoch + 1

    with pytest.raises(StaleGameOwner):
        await store.execute(game_id, definition, actor_id="user-a", command_id="old-owner",
            expected_revision=0, command="PING", payload={}, ownership=first)
    accepted = await store.execute(game_id, definition, actor_id="user-a", command_id="new-owner",
        expected_revision=0, command="PING", payload={}, ownership=second)
    assert accepted.receipt.status == "accepted"


async def test_active_player_reservation_prevents_two_games_and_releases_on_completion():
    store, definition = InMemoryGameStore(), DurableEchoGame()
    first, second = uuid4(), uuid4()
    await store.create(first, "room-a", definition)
    await store.create(second, "room-b", definition)
    await store.reserve_players(first, "room-a", (("user-a", 1), ("user-b", 2)))

    with pytest.raises(DurableGameConflict):
        await store.reserve_players(second, "room-b", (("user-a", 1), ("user-c", 2)))

    await store.release_players(first)
    await store.reserve_players(second, "room-b", (("user-a", 1), ("user-c", 2)))
    assert store.active_players["user-a"] == (second, "room-b", 1)


async def test_atomic_start_creates_game_reservations_and_first_ownership_once():
    store, definition, game_id = InMemoryGameStore(), DurableEchoGame(), uuid4()
    runtime = DurableCommandRuntime(store)
    players = (("user-a", 1), ("user-b", 2))

    started = await runtime.start_owned(game_id, "room", definition,
        start_command_id="start-once", owner_instance_id="server-a", players=players)
    assert started.created and started.ownership is not None
    assert started.ownership.epoch == 1
    assert {user for user, value in store.active_players.items() if value[0] == game_id} == {
        "user-a", "user-b",
    }

    retried = await runtime.start_owned(game_id, "room", definition,
        start_command_id="start-once", owner_instance_id="server-a", players=players)
    assert not retried.created and retried.ownership is None
    assert retried.game.game_id == game_id

    conflicting_id = uuid4()
    with pytest.raises(DurableGameConflict):
        await runtime.start_owned(conflicting_id, "other-room", definition,
            start_command_id="other-start", owner_instance_id="server-b",
            players=(("user-a", 1),))
    assert conflicting_id not in store.games


async def test_durable_runtime_commits_before_delivery_and_retry_does_not_redeliver():
    store, definition, game_id = InMemoryGameStore(), DurableEchoGame(), uuid4()
    runtime = DurableCommandRuntime(store)
    await runtime.start(game_id, "room", definition)
    ownership = await store.acquire(game_id, "server-a")
    command = ReliableActionCommand(match_id=str(game_id), command_id="stable-command",
        expected_revision=0, command="PING", payload={"message": "committed"})
    attempts = 0

    async def lost_response(events):
        nonlocal attempts
        attempts += 1
        assert len(events) == 1 and events[0].message["event"] == "PONG"
        raise ConnectionError("response lost after commit")

    with pytest.raises(ConnectionError):
        await runtime.execute(game_id, definition, "user-a", command, lost_response,
                              ownership=ownership)

    delivered = []

    async def deliver(events):
        delivered.extend(events)

    recovered = await runtime.execute(game_id, definition, "user-a", command, deliver,
                                      ownership=ownership)
    assert recovered["action_ack"] == {
        "command_id": "stable-command", "status": "accepted", "revision": 1,
    }
    assert recovered["game"] == {"revision": 1, "command_count": 1}
    assert attempts == 1 and delivered == []
    assert (await runtime.snapshot(game_id, definition, "user-a"))["game"]["revision"] == 1


class InternalTransitionGame:
    """Models an invisible recycle followed by a player-visible card draw."""

    game_type = "internal-transition-test"
    engine_version = event_schema_version = 1
    rules_schema_version = 1

    def normalize_rules(self, rules):
        if rules:
            raise ValueError("No configurable rules.")
        return {}

    def initial_state(self, rules=None, players=()):
        self.normalize_rules(rules or {})
        return {"revision": 0, "pickup": [], "hand": []}

    def decide(self, state, actor_id, command, payload):
        assert command == "DRAW"
        return (
            ProposedGameEvent(event_type="PICKUP_PILE_RECYCLED", payload={
                "pickup_order": ["9H", "3S", "KD"],
            }),
            ProposedGameEvent(event_type="CARD_DRAWN", payload={
                "actor_id": actor_id, "card": "9H",
            }),
        )

    def reduce(self, state, event):
        state = self.decode_state(state)
        if event.event_type == "PICKUP_PILE_RECYCLED":
            state["pickup"] = list(event.payload["pickup_order"])
        elif event.event_type == "CARD_DRAWN":
            if state["pickup"][0] != event.payload["card"]:
                raise ValueError("Drawn card does not match the pickup pile.")
            state["hand"].append(state["pickup"].pop(0))
        else:
            raise ValueError("Unsupported event.")
        state["revision"] += 1
        return state

    def revision(self, state):
        return state["revision"]

    def encode_state(self, state):
        return self.decode_state(state)

    def decode_state(self, value):
        return {"revision": value["revision"], "pickup": list(value["pickup"]),
                "hand": list(value["hand"])}

    def snapshot(self, state, user_id):
        return {"game": {"revision": state["revision"], "hand": list(state["hand"])}}

    def project(self, event):
        if event.event_type == "PICKUP_PILE_RECYCLED":
            return ()
        return (OutgoingEvent({"event": "CARD_DRAWN", "card": event.payload["card"]}),)


async def test_invisible_server_transition_is_persisted_replayed_and_not_delivered():
    store, definition, game_id = InMemoryGameStore(), InternalTransitionGame(), uuid4()
    runtime = DurableCommandRuntime(store)
    started = await runtime.start_owned(game_id, "room", definition,
        start_command_id="start", owner_instance_id="server-a", players=(("user-a", 1),))
    delivered = []

    async def deliver(events):
        delivered.extend(events)

    result = await runtime.execute(game_id, definition, "user-a", ReliableActionCommand(
        match_id=str(game_id), command_id="draw", expected_revision=0, command="DRAW",
    ), deliver, ownership=started.ownership)

    assert [item.event.event_type for item, _, _ in store.games[game_id].events] == [
        "PICKUP_PILE_RECYCLED", "CARD_DRAWN",
    ]
    assert [item.message["event"] for item in delivered] == ["CARD_DRAWN"]
    assert result["game"] == {"revision": 2, "hand": ["9H"]}
    recovered = await store.load(game_id, definition)
    assert recovered.state == {"revision": 2, "pickup": ["3S", "KD"], "hand": ["9H"]}


class RulesGame(DurableEchoGame):
    game_type = "locked-rules-test"
    rules_schema_version = 3

    def normalize_rules(self, rules):
        if set(rules) != {"winning_score"} or type(rules["winning_score"]) is not int:
            raise ValueError("winning_score is required")
        if not 1 <= rules["winning_score"] <= 100:
            raise ValueError("winning_score is outside its supported range")
        return {"winning_score": rules["winning_score"]}

    def initial_state(self, rules=None, players=()):
        self.normalize_rules(rules or {})
        return EchoState()


async def test_rules_are_validated_locked_recovered_and_checked_on_start_retry():
    store, definition, game_id = InMemoryGameStore(), RulesGame(), uuid4()
    runtime = DurableCommandRuntime(store)
    started = await runtime.start_owned(game_id, "room", definition,
        start_command_id="start", owner_instance_id="server-a", players=(("user-a", 1),),
        rules={"winning_score": 25})

    assert started.game.rules_schema_version == 3
    assert started.game.rules == {"winning_score": 25}
    assert len(started.game.rules_digest) == 64
    assert (await store.load(game_id, definition)).rules == {"winning_score": 25}

    same = await runtime.start_owned(game_id, "room", definition,
        start_command_id="start", owner_instance_id="server-a", players=(("user-a", 1),),
        rules={"winning_score": 25})
    assert not same.created and same.game.rules_digest == started.game.rules_digest

    with pytest.raises(DurableGameConflict):
        await runtime.start_owned(game_id, "room", definition,
            start_command_id="start", owner_instance_id="server-a",
            players=(("user-a", 1),), rules={"winning_score": 30})
    assert (await store.load(game_id, definition)).rules == {"winning_score": 25}
