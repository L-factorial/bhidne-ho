from dataclasses import replace
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


async def durable_host(game_type: str, count=None, *, declarations=False):
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
    count = count or (4 if game_type == "callbreak" else 2)
    waiting = await service.create("room", "u0", count, game_type)
    if game_type == "marriage":
        game = service.games["room"]
        game.marriage_scoring = replace(game.marriage_scoring, initial_tunnela_declaration=declarations)
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


@pytest.mark.parametrize('kind', ['marriage', 'flush'])
async def test_explicit_lock_durably_reserves_roster_until_terminal_end(kind):
    rooms = RoomService()
    for user in ("u0", "u1", "u2"):
        await rooms.join("room", user)
    store = InMemoryGameStore()
    service = GameHost(rooms, Delivery(), durable_runtime=DurableCommandRuntime(store),
                       runtime_mode="durable")
    waiting = await service.create("room", "u0", 2, kind)
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

        new = await service.create("room", "u2", 2, kind, name="New table")
        with pytest.raises(HTTPException) as conflict:
            await service.join("room", "u1", new['match_id'])
        assert conflict.value.detail['departure_command'] == 'end'
        await service.end("room", "u0", game.match_id)
        assert store.active_table_players == {}
        # Nobody played: End alone must release every reservation for the new roster.
        await service.join("room", "u1", new['match_id'])
        await service.table_command("room", "u2", new['match_id'], "lock")
        assert (await service.start("room", "u2", new['match_id'], rules_revision=0))['status'] == 'playing'
    finally:
        await service.close()


async def test_marriage_leave_folds_then_releases_and_records_durable_state():
    service, store, started = await durable_host('marriage')
    try:
        game = service.games['room']
        result = await service.leave('room', 'u1', game.match_id)
        assert result['status'] == 'finished'
        assert result['marriage']['public']['won_by_fold']
        assert result['marriage']['private'] is None
        assert 'u1' in game.departed
        assert 'u1' not in store.active_players and 'u1' not in store.active_table_players
        loaded = await store.load(game.durable_game_id, game.durable_definition)
        assert loaded.state == service._engine_state(game)
        again = await service.leave('room', 'u1', game.match_id)
        assert again['game']['revision'] == result['game']['revision']
        other = await service.create('room', 'u2', 2, 'marriage', name='Next table')
        await service.join('room', 'u1', other['match_id'])
        await service.table_command('room', 'u2', other['match_id'], 'lock')
    finally:
        await service.close()


async def test_marriage_departure_releases_only_folded_player_and_others_continue():
    service, store, started = await durable_host('marriage', 3)
    try:
        game = service.games['room']
        result = await service.leave('room', 'u1', game.match_id)
        assert result['status'] == 'playing'
        assert not result['table']['current_user']['is_seated']
        assert [(p['user_id'], p['seat_id']) for p in result['table']['seated_players']] == [('u0', 1), ('u2', 3)]
        assert set(store.active_players) == {'u0', 'u2'}
        again = await service.leave('room', 'u1', game.match_id)
        assert again['game']['revision'] == result['game']['revision']
        other = await service.create('room', 'u3', 2, 'marriage', name='Other')
        await service.join('room', 'u1', other['match_id'])
        await service.table_command('room', 'u3', other['match_id'], 'lock')
        drawn = await service.action('room', 'u0', GameAction(match_id=game.match_id,
            command_id='remaining-draw', expected_revision=result['game']['revision'], command='DRAW_CARD', payload={'source': 'stock'}))
        assert drawn['action_ack']['status'] == 'accepted'
        engine = game.marriage_target.adapter.checkpoint()
        assert len(engine.get_player_view('1').hand) == 22
        assert engine.get_state().players[1].folded
    finally:
        await service.close()


async def test_marriage_leave_rolls_back_fold_when_durable_commit_fails(monkeypatch):
    service, store, started = await durable_host('marriage')
    try:
        game = service.games['room']
        before = service._engine_state(game)
        async def fail(*args, **kwargs):
            raise RuntimeError('storage unavailable')
        monkeypatch.setattr(store, 'execute', fail)
        with pytest.raises(RuntimeError, match='storage unavailable'):
            await service.leave('room', 'u1', game.match_id)
        assert service._engine_state(game) == before
        assert 'u1' not in game.departed
        assert 'u1' in store.active_players
    finally:
        await service.close()


async def test_flush_leave_retains_reservation_until_round_completion():
    service, store, started = await durable_host('flush', 3)
    try:
        game = service.games['room']
        state = started
        for command in ['DEAL_CARDS', 'SKIP_CUT']:
            actor = game.users[state['game']['turn']['player_id'] - 1]
            state = await service.action('room', actor, GameAction(match_id=game.match_id,
                command_id=command, expected_revision=state['game']['revision'], command=command))
        actor = next(u for u in game.users if game.flush_seats[u] != state['game']['turn']['player_id'])
        left = await service.leave('room', actor, game.match_id)
        assert left['status'] == 'playing' and left['flush']['private'] is None
        assert left['game']['turn'] == state['game']['turn']
        assert actor in store.active_players and actor in game.users
        assert actor in game.pending_flush_departures
        assert len(store.active_players) == 3
        loaded = await store.load(game.durable_game_id, game.durable_definition)
        assert loaded.state == service._engine_state(game)
        again = await service.leave('room', actor, game.match_id)
        assert again['game']['revision'] == left['game']['revision']
        other = await service.create('room', 'u3', 2, 'flush', name='Other')
        with pytest.raises(HTTPException) as reserved:
            await service.join('room', actor, other['match_id'])
        assert reserved.value.detail['code'] == 'SEAT_RESERVED_UNTIL_ROUND_END'
        turn = left['game']['turn']['player_id']
        user = next(u for u in game.users if game.flush_seats[u] == turn)
        folded = await service.action('room', user, GameAction(match_id=game.match_id,
            command_id='remaining-fold', expected_revision=left['game']['revision'], command='FOLD'))
        assert folded['action_ack']['status'] == 'accepted'
        assert actor not in game.users and actor not in store.active_players
        assert not game.pending_flush_departures
        await service.join('room', actor, other['match_id'])
        await service.table_command('room', 'u3', other['match_id'], 'lock')
    finally:
        await service.close()


async def test_initial_tunnela_responses_are_durable_idempotent_and_gate_play():
    service, store, started = await durable_host('marriage', declarations=True)
    try:
        game = service.games['room']
        assert started['marriage']['public']['tunnela_declaration_pending']
        command = GameAction(match_id=game.match_id, command_id='initial-none-b',
            expected_revision=started['game']['revision'], command='DECLARE_TUNNELAS', payload={'melds': []})
        first = await service.action('room', 'u1', command)
        assert first['action_ack']['status'] == 'accepted'
        repeated = await service.action('room', 'u1', command)
        assert repeated['game']['revision'] == first['game']['revision']
        loaded = await store.load(game.durable_game_id, game.durable_definition)
        assert loaded.sequence == 1
        assert loaded.state == service._engine_state(game)
        final = await service.action('room', 'u0', GameAction(match_id=game.match_id,
            command_id='initial-none-a', expected_revision=first['game']['revision'],
            command='DECLARE_TUNNELAS', payload={'melds': []}))
        assert final['action_ack']['status'] == 'accepted'
        assert not final['marriage']['public']['tunnela_declaration_pending']
        assert 'draw' in final['marriage']['private']['actions']['kinds']
    finally:
        await service.close()
