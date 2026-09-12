import asyncio
import time
from contextlib import ExitStack

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.main import create_app
from app.multiplayer.connection_manager import ConnectionManager
from app.multiplayer.room_service import RoomService
from app.test_games.http import GameAction
from app.test_games.service import TestGameService as GameHost
from callbreak import Phase
from callbreak.audit import audit_match
from uuid import uuid4


class Delivery:
    def __init__(self):
        self.private = {}
        self.public = []
        self.private_events = []

    async def send_to_room_user(self, room, user, data):
        self.private[room, user] = data
        if data.get("type") == "GAME_EVENT":
            self.private_events.append((room, user, data))

    async def broadcast(self, room, data):
        self.public.append((room, data))


async def host(n, timeout=3):
    rooms, delivery = RoomService(), Delivery()
    for i in range(n + 1):
        await rooms.join("room", f"u{i}")
    service = GameHost(rooms, delivery, timeout_seconds=timeout)
    return service, delivery


@pytest.mark.parametrize("n", [4, 5])
async def test_full_table_waits_for_creator_then_completes_all_five_deals(n):
    service, delivery = await host(n, timeout=0.001)
    try:
        waiting = await service.create("room", "u0", n)
        assert waiting["status"] == "waiting" and waiting["your_player_id"] == 1
        for i in range(1, n):
            snapshot = await service.join("room", f"u{i}", waiting["match_id"])
            assert snapshot["status"] == "waiting"
        game = service.games["room"]
        assert game.state is None and game.task is None
        snapshot = await service.start("room", "u0", waiting["match_id"])
        assert 1 <= game.state.initial_dealer <= n and game.state.phase == Phase.AWAITING_SHUFFLE
        assert game.users == [f"u{i}" for i in range(n)]
        assert snapshot["game"]["turn"]["player_id"] == game.state.initial_dealer
        with pytest.raises(HTTPException):
            await service.join("room", f"u{n}", waiting["match_id"])
        spectator = await service.snapshot("room", f"u{n}")
        assert spectator["private"] is None and spectator["your_player_id"] is None
        # Duplicate tabs/reconnects reuse the same seat.
        assert (await service.join("room", "u0", waiting["match_id"]))["your_player_id"] == 1
        await asyncio.wait_for(game.task, timeout=10)
        assert game.error is None and game.state.phase == Phase.MATCH_COMPLETE
        audit_match(game.state)
        assert len(game.state.completed_deals) == 5
        assert all(sum(d.result.tricks_won) == 52 // n for d in game.state.completed_deals)
        assert any(data.get("event") == "AutoAction" for _, data in delivery.public)
        assert all(data.get("event") not in ("CARD_DEALT", "HAND_REVIEW_REQUESTED", "REDEAL_ELIGIBLE") for _, data in delivery.public)
        assert not any("card" in data.get("payload", {}) for _, data in delivery.public if data.get("event") == "CARD_DISTRIBUTED")
        events = [data for _, data in delivery.public if data.get("type") == "GAME_EVENT"]
        assert sum(e["event"] == "CARD_DISTRIBUTED" for e in events) == 5 * n * (52 // n)
        assert sum(e["event"] == "MATCH_COMPLETED" for e in events) == 1
        cards = [(room, user, e) for room, user, e in delivery.private_events if e["event"] == "CARD_DEALT"]
        assert len(cards) == 5 * n * (52 // n)
        assert all(room == "room" and user == f"u{e['payload']['player_id'] - 1}" for room, user, e in cards)
        assert all(e["protocol_version"] == 1 and e["match_id"] == game.match_id for e in events)
        snapshot = await service.snapshot("room", "u0")
        assert snapshot["status"] == "finished" and snapshot["remaining_ms"] is None
        assert len(snapshot["deal_history"]) == 5
        for history, completed in zip(snapshot["deal_history"], game.state.completed_deals):
            assert history["complete"] and history["deal_number"] == completed.deal.number
            for row in history["players"]:
                seat = row["player_id"] - 1
                assert row["bid"] == completed.deal.players[seat].bid
                assert row["tricks_won"] == completed.result.tricks_won[seat]
                assert row["score_tenths"] == completed.result.score_tenths[seat]
                assert (row["score_tenths"] < 0) == (row["tricks_won"] < row["bid"])
                assert "hand" not in row

        replacement = await service.create("room", "u0", n)
        assert replacement["match_id"] != waiting["match_id"]
    finally:
        await service.close()


async def manual_host(n=4):
    service, delivery = await host(n)
    waiting = await service.create("room", "u0", n)
    for i in range(1, n):
        await service.join("room", f"u{i}", waiting["match_id"])
    await service.start("room", "u0", waiting["match_id"], "manual")
    return service, delivery, service.games["room"]


def next_action(service, game):
    actor = game.state.current_player
    if game.state.phase == Phase.HAND_REVIEW:
        actor = next(p for p in game.state.config.players if p not in game.state.current_deal.accepted_hands)
        command, payload = "ACCEPT_HAND", {}
    else:
        command, payload = service._heuristic(game.state, actor)
    return f"u{actor - 1}", GameAction(match_id=game.match_id, command_id=uuid4().hex,
        expected_revision=game.state.revision, command=command, payload=payload)


@pytest.mark.parametrize("n", [4, 5])
async def test_retry_every_move_through_full_match_and_cancel_delivery(n):
    service, delivery, game = await manual_host(n)
    interrupted = set()
    while game.state.phase != Phase.MATCH_COMPLETE:
        user, body = next_action(service, game)
        phase = game.state.phase
        if phase in (Phase.AWAITING_SHUFFLE, Phase.BIDDING, Phase.PLAYING) and phase not in interrupted:
            entered = asyncio.Event()
            original = delivery.broadcast

            async def block(*args):
                entered.set()
                await asyncio.Event().wait()

            delivery.broadcast = block
            task = asyncio.create_task(service.action("room", user, body))
            await asyncio.wait_for(entered.wait(), 2)
            task.cancel()
            with pytest.raises(asyncio.CancelledError):
                await task
            delivery.broadcast = original
            interrupted.add(phase)
            # The caller never received its response and its socket disappears.
            await service.rooms.leave("room", user)
            with pytest.raises(HTTPException) as error:
                await service.action("room", user, body)
            assert error.value.status_code == 403
            await service.rooms.join("room", user)
            receipt = game.commands.receipts[user, body.command_id][1]
        else:
            receipt = (await service.action("room", user, body))["action_ack"]
        assert receipt["status"] == "accepted"
        committed_state, deadline = game.state, game.deadline
        events = len(delivery.public), len(delivery.private_events)
        first, second = await asyncio.gather(service.action("room", user, body), service.action("room", user, body))
        assert first["action_ack"] == second["action_ack"] == receipt
        assert game.state is committed_state and game.deadline == deadline
        assert (len(delivery.public), len(delivery.private_events)) == events
        view = await service.snapshot("room", user)
        for key in ("private", "game", "scoreboard", "deal_history"):
            assert first[key] == view[key]
        assert "action_ack" not in view
    assert interrupted == {Phase.AWAITING_SHUFFLE, Phase.BIDDING, Phase.PLAYING}
    audit_match(game.state)
    assert len(game.state.completed_deals) == 5
    old_body = body
    replacement = await service.create("room", "u0", n)
    with pytest.raises(HTTPException) as error:
        await service.action("room", user, old_body)
    assert error.value.status_code == 409
    assert replacement["match_id"] != old_body.match_id
    await service.close()


async def test_action_receipts_rejection_conflict_identity_and_fresh_snapshot():
    service, delivery, game = await manual_host()
    user, body = next_action(service, game)
    other = f"u{(game.state.current_player % 4)}"
    rejected = await service.action("room", other, body)
    assert rejected["action_ack"]["status"] == "rejected"
    accepted = await service.action("room", user, body)
    assert accepted["action_ack"]["status"] == "accepted"
    assert (await service.action("room", other, body))["action_ack"] == rejected["action_ack"]
    conflicting = body.model_copy(update={"expected_revision": game.state.revision})
    with pytest.raises(HTTPException) as error:
        await service.action("room", user, conflicting)
    assert error.value.status_code == 409
    next_user, next_body = next_action(service, game)
    # Simultaneous first submissions, not merely repeated calls after completion.
    results = await asyncio.gather(service.action("room", next_user, next_body), service.action("room", next_user, next_body))
    assert results[0]["action_ack"] == results[1]["action_ack"]
    retry = await service.action("room", user, body)
    assert retry["game"]["revision"] > retry["action_ack"]["revision"]
    assert retry["action_ack"] == accepted["action_ack"]
    stale = body.model_copy(update={"command_id": "stale-command"})
    result = await service.action("room", user, stale)
    assert result["action_ack"]["status"] == "rejected"
    assert (await service.action("room", user, stale))["action_ack"] == result["action_ack"]
    with pytest.raises(HTTPException) as error:
        await service.action("room", "u4", body)
    assert error.value.status_code == 403
    assert not any("action_ack" in data for _, data in delivery.public)
    game.commands.receipt_limit = len(game.commands.receipts)
    next_user, next_body = next_action(service, game)
    state = game.state
    with pytest.raises(HTTPException) as error:
        await service.action("room", next_user, next_body)
    assert error.value.status_code == 409 and game.state is state
    assert (await service.action("room", user, body))["action_ack"] == accepted["action_ack"]
    await service.close()


async def test_controller_failure_rolls_back_before_retry():
    service, delivery, game = await manual_host()
    user, body = next_action(service, game)
    before, log, events = game.state, list(game.log), len(delivery.public)
    original = service._apply_controllers

    def fail(*args, **kwargs):
        raise RuntimeError("simulated controller failure")

    service._apply_controllers = fail
    with pytest.raises(RuntimeError):
        await service.action("room", user, body)
    assert game.state is before and game.log == log and len(delivery.public) == events
    assert not game.commands.receipts
    service._apply_controllers = original
    assert (await service.action("room", user, body))["action_ack"]["status"] == "accepted"
    await service.close()


async def test_manual_actions_stale_commands_and_three_second_deadline():
    service, delivery = await host(4)
    try:
        waiting = await service.create("room", "u0", 4)
        for i in range(1, 4):
            await service.join("room", f"u{i}", waiting["match_id"])
        game = service.games["room"]
        await service.start("room", "u0", waiting["match_id"])
        dealer = game.state.initial_dealer
        dealer_user = f"u{dealer - 1}"
        cutter = dealer % 4 + 1
        cutter_user = f"u{cutter - 1}"
        initial_deadline = game.deadline
        assert 2.5 < game.deadline - time.monotonic() <= 3
        body = GameAction(match_id=game.match_id, expected_revision=game.state.revision, command="SHUFFLE_DECK")
        with pytest.raises(HTTPException):
            await service.action("room", cutter_user, body)
        assert game.deadline == initial_deadline
        result = await service.action("room", dealer_user, body)
        assert result["game"]["phase"] == "AWAITING_CUT" and game.state.current_player == cutter
        with pytest.raises(HTTPException):
            await service.action("room", dealer_user, body)
        for user, command in [(cutter_user, "SKIP_CUT"), (dealer_user, "START_DISTRIBUTION")]:
            await service.action("room", user, GameAction(match_id=game.match_id, expected_revision=game.state.revision, command=command))
        assert game.state.phase == Phase.HAND_REVIEW
        audit_match(game.state)
        for i in range(4):
            view = await service.snapshot("room", f"u{i}")
            assert view["private"]["hand"] == list(map(str, game.state.current_deal.players[i].hand))
        review_deadline = game.deadline
        await service.action("room", "u0", GameAction(match_id=game.match_id, expected_revision=game.state.revision, command="ACCEPT_HAND"))
        assert game.deadline == review_deadline
        history = (await service.snapshot("room", "u0"))["deal_history"]
        assert len(history) == 1 and not history[0]["complete"]
        assert all(row["bid"] is None and row["score_tenths"] is None for row in history[0]["players"])

        with pytest.raises(HTTPException) as error:
            await service.action("room", "u4", GameAction(match_id=game.match_id, expected_revision=game.state.revision, command="ACCEPT_HAND"))
        assert error.value.status_code == 403
    finally:
        await service.close()
    assert game.task.done()


async def test_private_delivery_scoped_to_room_and_user():
    class Socket:
        def __init__(self): self.messages = []
        async def send_json(self, value): self.messages.append(value)
        async def close(self, code): pass
    rooms = RoomService()
    manager = ConnectionManager(rooms)
    one, other_room, other_user = Socket(), Socket(), Socket()
    await manager.connect("a", "alice", one)
    await manager.connect("b", "alice", other_room)
    await manager.connect("a", "bob", other_user)
    await manager.send_to_room_user("a", "alice", {"private": "QH"})
    assert one.messages == [{"private": "QH"}]
    assert other_room.messages == other_user.messages == []


def test_console_http_auth_lobby_and_validation():
    with TestClient(create_app()) as client, ExitStack() as stack:
        assert client.get('/test-games/room').status_code == 401
        users = [client.post('/auth/guest').json() for _ in range(4)]
        headers = [{"Authorization": f"Bearer {u['token']}"} for u in users]
        assert client.post('/test-games/room', headers=headers[0], json={"player_count": 4}).status_code == 403
        for u in users:
            socket = stack.enter_context(client.websocket_connect(f"/ws/rooms/room?token={u['token']}"))
            socket.receive_json()
        assert client.get('/test-games/room', headers=headers[0]).json()['status'] == 'empty'
        response = client.post('/test-games/room', headers=headers[0], json={"player_count": 4})
        assert response.status_code == 201 and response.headers['cache-control'] == 'no-store'
        match_id = response.json()['match_id']
        for h in headers[1:]:
            assert client.post('/test-games/room/join', headers=h, json={"match_id": match_id}).status_code == 200
        assert client.post('/test-games/room/start', headers=headers[1], json={'match_id': match_id}).status_code == 403
        assert client.post('/test-games/room/start', headers=headers[0], json={'match_id': match_id, 'play_mode': 'invalid'}).status_code == 422
        started = client.post('/test-games/room/start', headers=headers[0], json={'match_id': match_id, 'play_mode': 'manual'})
        assert started.status_code == 200
        assert started.json()['play_mode'] == 'manual'
        assert started.json()['remaining_ms'] is None
        state = client.get('/test-games/room', headers=headers[0]).json()
        assert state['game']['phase'] == 'AWAITING_SHUFFLE'
        assert client.post('/test-games/room/action', headers=headers[0], json={
            "match_id": match_id, "expected_revision": state['game']['revision'],
            "command": "SHUFFLE_DECK", "player_id": 1}).status_code == 422
        body = {"match_id": match_id, "expected_revision": state['game']['revision'],
                "command": "SHUFFLE_DECK", "command_id": "http-command-1"}
        for invalid_id in ["", " ", "x" * 129, 123, "a/b"]:
            assert client.post('/test-games/room/action', headers=headers[0],
                               json={**body, "command_id": invalid_id}).status_code == 422
        dealer_headers = headers[state['game']['turn']['player_id'] - 1]
        accepted = client.post('/test-games/room/action', headers=dealer_headers, json=body)
        assert accepted.status_code == 200 and accepted.headers['cache-control'] == 'no-store'
        assert accepted.json()['action_ack']['status'] == 'accepted'
        retried = client.post('/test-games/room/action', headers=dealer_headers, json=body)
        assert retried.json()['action_ack'] == accepted.json()['action_ack']
        assert retried.json()['game'] == accepted.json()['game']
        rejected = client.post('/test-games/room/action', headers=dealer_headers,
                               json={**body, "command_id": "http-command-2"})
        assert rejected.status_code == 200 and rejected.json()['action_ack']['status'] == 'rejected'
        assert 'Call Break test game' in client.get('/').text
        assert client.get('/test-ui/test-games.js').status_code == 200


async def test_creator_settings_start_quorum_and_locking():
    from app.test_games.http import GameSettings
    service, _ = await host(4)
    try:
        game = await service.create("room", "u0", 4)
        mid = game["match_id"]
        settings = GameSettings(match_id=mid, weak_hand_enabled=False, no_spades_enabled=False,
                                payments=[10, 20, 30, 0])
        with pytest.raises(HTTPException) as error:
            await service.start("room", "u0", mid)
        assert error.value.status_code == 409
        with pytest.raises(HTTPException) as error:
            await service.configure("room", "u1", settings)
        assert error.value.status_code == 403
        await service.configure("room", "u0", settings)
        for i in range(1, 4):
            snapshot = await service.join("room", f"u{i}", mid)
        assert snapshot["ready"] and snapshot["settings"]["payments"] == [10, 20, 30, 0]
        assert not snapshot["is_creator"] and snapshot["status"] == "waiting"
        with pytest.raises(HTTPException):
            await service.start("room", "u0", "stale")
        snapshot = await service.start("room", "u0", mid)
        assert not snapshot["rules"]["redeal"]["weak_hand_enabled"]
        assert not snapshot["rules"]["redeal"]["no_spades_enabled"]
        with pytest.raises(HTTPException):
            await service.configure("room", "u0", settings)
        with pytest.raises(HTTPException):
            await service.start("room", "u0", mid)
    finally:
        await service.close()


@pytest.mark.parametrize("n", [4, 5])
async def test_player_play_waits_for_input_and_completes_match(n):
    service, delivery = await host(n, timeout=0.001)
    try:
        waiting = await service.create("room", "u0", n)
        for i in range(1, n):
            await service.join("room", f"u{i}", waiting["match_id"])
        snapshot = await service.start("room", "u0", waiting["match_id"], "manual")
        game = service.games["room"]
        assert snapshot["play_mode"] == "manual"
        assert snapshot["remaining_ms"] is None and snapshot["timeout_seconds"] is None
        assert game.task is None
        checked_phases = set()
        while game.state.phase != Phase.MATCH_COMPLETE:
            phase = game.state.phase
            if phase not in checked_phases:
                revision = game.state.revision
                await asyncio.sleep(0.02)
                assert game.state.revision == revision
                checked_phases.add(phase)
            actor = game.state.current_player
            payload = {}
            if phase == Phase.HAND_REVIEW:
                actor = next(p for p in game.state.config.players if p not in game.state.current_deal.accepted_hands)
                command = "ACCEPT_HAND"
            elif phase == Phase.BIDDING:
                command, payload = "PLACE_BID", {"amount": 2}
            elif phase == Phase.PLAYING:
                view = await service.snapshot("room", f"u{actor - 1}")
                command, payload = "PLAY_CARD", {"card": view["private"]["legal_cards"][-1]}
            else:
                command = {Phase.AWAITING_SHUFFLE: "SHUFFLE_DECK", Phase.AWAITING_CUT: "SKIP_CUT",
                           Phase.AWAITING_DISTRIBUTION: "START_DISTRIBUTION"}[phase]
            body = GameAction(match_id=game.match_id, expected_revision=game.state.revision,
                              command=command, payload=payload)
            if phase in (Phase.BIDDING, Phase.PLAYING) and game.state.current_deal.number == 1:
                revision = game.state.revision
                with pytest.raises(HTTPException):
                    await service.action("room", f"u{actor % n}", body)
                assert game.state.revision == revision
            snapshot = await service.action("room", f"u{actor - 1}", body)
            assert snapshot["remaining_ms"] is None and game.deadline is None
        audit_match(game.state)
        assert len(game.state.completed_deals) == 5
        assert all(p.bid == 2 for d in game.state.completed_deals for p in d.deal.players)
        assert not any(data.get("event") == "AutoAction" for _, data in delivery.public)
        assert {Phase.BIDDING, Phase.PLAYING, Phase.HAND_REVIEW} <= checked_phases
    finally:
        await service.close()


@pytest.mark.parametrize("started", [False, True])
async def test_creator_can_end_waiting_or_running_game_and_replace_it(started):
    service, delivery = await host(4, timeout=0.01)
    try:
        first = await service.create('room', 'u0', 4)
        mid = first['match_id']
        for i in range(1, 4): await service.join('room', f'u{i}', mid)
        if started: await service.start('room', 'u0', mid, 'auto')
        game = service.games['room']
        state = game.state
        for user, match, status in [('u1', mid, 403), ('u4', mid, 403),
                                     ('outsider', mid, 403), ('u0', 'stale', 409)]:
            with pytest.raises(HTTPException) as error: await service.end('room', user, match)
            assert error.value.status_code == status
        result = await service.end('room', 'u0', mid)
        assert result['status'] == 'ended' and not result['can_join']
        assert game.deadline is None and game.state is state
        assert (await service.end('room', 'u0', mid))['status'] == 'ended'
        await asyncio.sleep(0.03)
        assert game.state is state
        if started: assert game.task.done()
        for i in range(5):
            assert delivery.private['room', f'u{i}']['payload']['status'] == 'ended'
        with pytest.raises(HTTPException): await service.join('room', 'u4', mid)
        with pytest.raises(HTTPException): await service.start('room', 'u0', mid)
        if started:
            with pytest.raises(HTTPException) as error:
                await service.action('room', 'u0', GameAction(match_id=mid,
                    expected_revision=state.revision, command='SHUFFLE_DECK'))
            assert error.value.status_code == 409
        replacement = await service.create('room', 'u0', 4)
        assert replacement['match_id'] != mid and replacement['status'] == 'waiting'
        with pytest.raises(HTTPException): await service.end('room', 'u0', mid)
        assert service.games['room'].ended is False
    finally:
        await service.close()


def test_end_game_http_requires_authentication_and_match_identity():
    with TestClient(create_app()) as client:
        assert client.post('/test-games/room/end', json={'match_id': 'old'}).status_code == 401
        user = client.post('/auth/guest').json()
        headers = {'Authorization': f"Bearer {user['token']}"}
        with client.websocket_connect(f"/ws/rooms/room?token={user['token']}") as socket:
            socket.receive_json()
            mid = client.post('/test-games/room', headers=headers, json={'player_count': 4}).json()['match_id']
            assert client.post('/test-games/room/end', headers=headers, json={}).status_code == 422
            ended = client.post('/test-games/room/end', headers=headers, json={'match_id': mid})
            assert ended.status_code == 200 and ended.json()['status'] == 'ended'
            assert ended.headers['cache-control'] == 'no-store'


@pytest.mark.parametrize("n", [4, 5])
async def test_manual_round_summary_holds_scores_and_creator_advances_once(n):
    service, delivery, game = await manual_host(n)
    service.round_summary_seconds = 8
    try:
        for round_number in range(1, 6):
            for _ in range(150):
                if game.state.phase in (Phase.DEAL_COMPLETE, Phase.MATCH_COMPLETE): break
                user, command = next_action(service, game)
                await service.action('room', user, command)
            assert len(game.state.completed_deals) == round_number
            audit_match(game.state)
            before = game.state
            if round_number == 5:
                assert game.state.phase == Phase.MATCH_COMPLETE
                assert 'round_review' not in await service.snapshot('room', 'u0')
                with pytest.raises(HTTPException): await service.next_deal('room', 'u0', game.match_id, 5)
                break
            assert game.state.phase == Phase.DEAL_COMPLETE and game.deadline is None
            summary = await service.snapshot('room', 'u0')
            assert summary['round_review'] == {'deal_number': round_number, 'can_continue': True}
            assert summary['deal_history'][-1]['complete']
            assert summary['deal']['tricks'][-1]['complete']
            assert not (await service.snapshot('room', 'u1'))['round_review']['can_continue']
            for user, match, number, status in [('u1', game.match_id, round_number, 403),
                ('outsider', game.match_id, round_number, 403), ('u0', 'stale', round_number, 409),
                ('u0', game.match_id, round_number + 1, 409)]:
                with pytest.raises(HTTPException) as error: await service.next_deal('room', user, match, number)
                assert error.value.status_code == status
            assert game.state is before
            results = await asyncio.gather(*[service.next_deal('room', 'u0', game.match_id, round_number) for _ in range(2)])
            assert results[0]['game']['revision'] == results[1]['game']['revision']
            assert game.state.phase == Phase.AWAITING_SHUFFLE
            assert game.state.preparation.number == round_number + 1
    finally:
        await service.close()


async def test_autoplay_round_summary_waits_for_deadline_and_ending_stops_it():
    service, _, game = await manual_host()
    service.round_summary_seconds = 8
    try:
        while game.state.phase != Phase.DEAL_COMPLETE:
            user, command = next_action(service, game)
            await service.action('room', user, command)
        game.play_mode = 'auto'
        service._deadline(game, Phase.PLAYING)
        game.task = asyncio.create_task(service._run(game))
        await asyncio.sleep(0.15)
        assert game.state.phase == Phase.DEAL_COMPLETE
        assert (await service.snapshot('room', 'u0'))['remaining_ms'] > 7000
        game.deadline = time.monotonic() - 1
        for _ in range(10):
            await asyncio.sleep(0.02)
            if game.state.phase == Phase.AWAITING_SHUFFLE: break
        assert game.state.phase == Phase.AWAITING_SHUFFLE
        assert 'round_review' not in await service.snapshot('room', 'u0')
        await service.end('room', 'u0', game.match_id)
        before = game.state
        await asyncio.sleep(0.15)
        assert game.state is before and game.task.done()
    finally:
        await service.close()
