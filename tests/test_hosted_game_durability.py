import pytest
from fastapi import HTTPException

from app.durable_games import DurableCommandRuntime, InMemoryGameStore
from app.durable_games.store import DurableGameConflict
from app.multiplayer.room_service import RoomService
from app.test_games.http import GameAction
from app.test_games.service import TestGameService as GameHost


class Delivery:
    async def broadcast(self, *args):
        pass

    async def send_to_room_user(self, *args):
        pass


async def durable_host(game_type: str):
    rooms = RoomService()
    for user in ("u0", "u1", "u2", "u3"):
        await rooms.join("room", user)
    store = InMemoryGameStore()
    service = GameHost(
        rooms,
        Delivery(),
        durable_runtime=DurableCommandRuntime(store),
        runtime_mode="durable",
    )
    count = 4 if game_type == "callbreak" else 2
    waiting = await service.create("room", "u0", count, game_type)
    for index in range(1, count):
        await service.join("room", f"u{index}", waiting["match_id"])
    if game_type in ("flush", "marriage"):
        await service.table_command("room", "u0", waiting["match_id"], "lock")
    start_args = {"rules_revision": 0} if game_type == "flush" else {}
    started = await service.start("room", "u0", waiting["match_id"], **start_args)
    return service, store, started


async def test_callbreak_engine_state_is_committed_to_durable_journal():
    service, store, started = await durable_host("callbreak")
    try:
        game = service.games["room"]
        actor = game.state.current_player
        body = GameAction(match_id=game.match_id, command_id="shuffle",
            expected_revision=started["game"]["revision"], command="SHUFFLE_DECK")
        await service.action("room", f"u{actor - 1}", body)
        loaded = await store.load(game.durable_game_id, game.durable_definition)
        assert loaded.sequence == 1
        assert loaded.revision == game.state.revision
        assert loaded.state == service._engine_state(game)
    finally:
        await service.close()


async def test_marriage_engine_state_is_committed_to_durable_journal():
    service, store, started = await durable_host("marriage")
    try:
        game = service.games["room"]
        body = GameAction(match_id=game.match_id, command_id="draw",
            expected_revision=started["game"]["revision"], command="DRAW_CARD",
            payload={"source": "stock"})
        await service.action("room", "u0", body)
        loaded = await store.load(game.durable_game_id, game.durable_definition)
        assert loaded.sequence == 1
        assert loaded.revision == game.marriage_target.adapter.revision
        assert loaded.state == service._engine_state(game)
    finally:
        await service.close()


async def test_flush_engine_state_is_committed_to_durable_journal():
    service, store, started = await durable_host("flush")
    try:
        game = service.games["room"]
        actor = started["game"]["turn"]["player_id"]
        body = GameAction(match_id=game.match_id, command_id="deal",
            expected_revision=started["game"]["revision"], command="DEAL_CARDS")
        await service.action("room", game.users[actor - 1], body)
        loaded = await store.load(game.durable_game_id, game.durable_definition)
        assert loaded.sequence == 1
        assert loaded.revision == game.flush_target.adapter.revision
        assert loaded.state == service._engine_state(game)
    finally:
        await service.close()


async def test_failed_durable_start_rolls_back_the_in_memory_engine():
    rooms = RoomService()
    for user in ("u0", "u1", "u2", "u3"):
        await rooms.join("room", user)
    store = InMemoryGameStore()
    service = GameHost(rooms, Delivery(), durable_runtime=DurableCommandRuntime(store),
                       runtime_mode="durable")
    waiting = await service.create("room", "u0", 4, "callbreak")
    for index in range(1, 4):
        await service.join("room", f"u{index}", waiting["match_id"])
    original_start = store.start

    async def unavailable(*args, **kwargs):
        raise RuntimeError("database unavailable")

    store.start = unavailable
    try:
        with pytest.raises(RuntimeError, match="database unavailable"):
            await service.start("room", "u0", waiting["match_id"])
        game = service.games["room"]
        assert not game.started
        assert game.table.phase != "STARTED"
        store.start = original_start
        assert (await service.start("room", "u0", waiting["match_id"]))["status"] == "playing"
    finally:
        await service.close()


async def test_conflicting_durable_player_reservation_is_a_graceful_http_conflict():
    rooms = RoomService()
    for user in ("u0", "u1", "u2", "u3"):
        await rooms.join("room", user)
    store = InMemoryGameStore()
    service = GameHost(rooms, Delivery(), durable_runtime=DurableCommandRuntime(store),
                       runtime_mode="durable")
    waiting = await service.create("room", "u0", 4, "callbreak")
    for index in range(1, 4):
        await service.join("room", f"u{index}", waiting["match_id"])
    original_start = store.start

    async def conflict(*args, **kwargs):
        raise DurableGameConflict("A player is already participating in another active game.")

    store.start = conflict
    try:
        with pytest.raises(HTTPException) as caught:
            await service.start("room", "u0", waiting["match_id"])
        assert caught.value.status_code == 409
        assert "another active game" in caught.value.detail
        game = service.games["room"]
        assert not game.started
        assert game.table.phase != "STARTED"

        store.start = original_start
        assert (await service.start("room", "u0", waiting["match_id"]))["status"] == "playing"
    finally:
        await service.close()


async def test_ending_a_hosted_game_releases_durable_player_reservations():
    service, store, started = await durable_host("callbreak")
    try:
        game = service.games["room"]
        assert {value[0] for value in store.active_players.values()} == {game.durable_game_id}
        assert {value[0] for value in store.active_table_players.values()} == {game.table.table_id}

        await service.end("room", "u0", started["match_id"])

        assert store.active_players == {}
        assert store.active_table_players == {}
    finally:
        await service.close()


async def test_explicit_lock_durably_reserves_roster_until_terminal_end():
    rooms = RoomService()
    for user in ("u0", "u1"):
        await rooms.join("room", user)
    store = InMemoryGameStore()
    service = GameHost(rooms, Delivery(), durable_runtime=DurableCommandRuntime(store),
                       runtime_mode="durable")
    waiting = await service.create("room", "u0", 2, "marriage")
    await service.join("room", "u1", waiting["match_id"])
    game = service.games["room"]
    try:
        await service.table_command("room", "u0", game.match_id, "lock")
        assert set(store.active_table_players) == {"u0", "u1"}
        assert store.active_players == {}

        with pytest.raises(HTTPException) as caught:
            await service.table_command("room", "u1", game.match_id, "leave-seat")
        assert caught.value.detail["code"] == "ROSTER_LOCKED"
        assert set(store.active_table_players) == {"u0", "u1"}

        await service.end("room", "u0", game.match_id)
        assert store.active_table_players == {}
    finally:
        await service.close()
