"""Detached runtime rebuilding; receipt fixtures simulate one committed store view."""
from copy import deepcopy
import json
from random import Random
from uuid import uuid4

from fastapi import HTTPException
import pytest

from app.durable_games.checkpoints import CheckpointError, capture_checkpoint
from app.durable_games.recovery import lookup_recovered_receipt, rebuild_hosted_game
from app.runtime.command_runtime import CommandAccessError
from app.test_games.http import GameAction
from app.test_games.service import TestGameService as GameHost
from flush import FlushGameEngine
from marriage import MarriageGameEngine
from test_hosted_checkpoints import action, engine_state, make_host, start


class Delivery:
    def __init__(self): self.events = []
    async def broadcast(self, *args): self.events.append(args)
    async def send_to_room_user(self, *args): self.events.append(args)


def receipt_view(game):
    """Test-only export. Production must load original requests/outcomes from DB."""
    state = engine_state(game)
    rows = []
    for (actor, command_id), (fingerprint, outcome) in game.commands.receipts.items():
        rows.append({'actor_id': actor, 'request': {**json.loads(fingerprint), 'command_id': command_id},
                     'fingerprint': fingerprint, 'outcome': deepcopy(outcome)})
    return {'match_id': game.match_id, 'revision': state.revision if state else 0,
            'receipt_count': len(rows), 'receipt_limit': game.commands.receipt_limit, 'receipts': rows}


def install_for_test(host, rebuilt):
    """Only tests activate directly; production needs fenced DB recovery first."""
    game = rebuilt.game
    host.tables.setdefault(game.room_id, {})[game.match_id] = game
    host.games[game.room_id] = game
    return game


async def create_receipted_game(kind):
    host, game = await make_host(kind)
    await start(host, game)
    command = {'callbreak': 'SHUFFLE_DECK', 'marriage': 'DRAW_CARD', 'flush': 'DEAL_CARDS'}[kind]
    await action(host, game, command, {'source': 'stock'} if kind == 'marriage' else None)
    # Stable rejection must survive just like an accepted outcome.
    await host.action('room', 'u0', GameAction(match_id=game.match_id, command_id='stale',
        expected_revision=0, command=command, payload={'source': 'stock'} if kind == 'marriage' else {}))
    return host, game


@pytest.mark.parametrize('kind', ['callbreak', 'marriage', 'flush'])
async def test_restored_game_retries_and_continues_with_fresh_resources(kind, monkeypatch):
    original_host, original = await create_receipted_game(kind)
    delivery = Delivery()
    host = GameHost(original_host.rooms, delivery)
    try:
        checkpoint = capture_checkpoint(original, table_revision=4)
        receipts = receipt_view(original)
        with monkeypatch.context() as patch:
            def forbidden(*args, **kwargs): raise AssertionError('Recovery attempted to start or deal a game')
            for engine in (MarriageGameEngine, FlushGameEngine):
                patch.setattr(engine, '__init__', forbidden)
                patch.setattr(engine, 'start_game', forbidden)
            rebuilt = rebuild_hosted_game(host, checkpoint, receipt_snapshot=receipts)
        assert host.tables == {} and host.games == {} and host._offer_tasks == {}
        game = install_for_test(host, rebuilt)
        assert game.commands.lock is not original.commands.lock
        assert game.commands.receipts is not original.commands.receipts
        assert game.task is None and game.durable_ownership is None and game.deadline is None
        assert not game.durable_table_reserved and game.ledger_retry_at == 0
        assert rebuilt.table_revision == 4
        assert capture_checkpoint(game, table_revision=4) == checkpoint
        for user in [*original.users, 'spectator']:
            assert host._snapshot(game, user) == original_host._snapshot(original, user)
        before = engine_state(game)
        for row in receipts['receipts']:
            request = GameAction(**row['request'])
            result = await host.action('room', row['actor_id'], request)
            assert result['action_ack'] == row['outcome']
        assert delivery.events == [] and engine_state(game) == before
        accepted = receipts['receipts'][0]
        conflicting = GameAction(**{**accepted['request'], 'expected_revision': accepted['request']['expected_revision'] + 1})
        with pytest.raises(HTTPException) as error:
            await host.action('room', accepted['actor_id'], conflicting)
        assert error.value.status_code == 409
        request = GameAction(**accepted['request'])
        assert lookup_recovered_receipt(game, 'not-the-actor', request) is None
        result = lookup_recovered_receipt(game, accepted['actor_id'], request)
        result['revision'] = -1
        assert lookup_recovered_receipt(game, accepted['actor_id'], request) == accepted['outcome']

        if kind == 'marriage':
            card = before.players[before.current_seat].hand[-1]
            await action(host, game, 'DISCARD_CARD', {'card_id': card.card_id})
        else:
            await action(host, game, 'SKIP_CUT')
        assert engine_state(game).revision > before.revision
        assert engine_state(original) == before
        assert delivery.events
    finally:
        await host.close()
        await original_host.close()


@pytest.mark.parametrize('kind', ['callbreak', 'marriage', 'flush'])
async def test_waiting_lobby_rebuild_can_start(kind):
    source, original = await make_host(kind)
    host = GameHost(source.rooms, Delivery())
    try:
        rebuilt = rebuild_hosted_game(host, capture_checkpoint(original, table_revision=0),
                                      receipt_snapshot=receipt_view(original))
        game = install_for_test(host, rebuilt)
        assert not game.started and game.match_id == original.match_id
        await start(host, game)
        assert game.started and not original.started
    finally:
        await host.close()
        await source.close()


@pytest.mark.parametrize('corrupt', [
    lambda r: r.update(revision=r['revision'] + 1),
    lambda r: r.update(receipt_count=r['receipt_count'] + 1),
    lambda r: r.update(receipt_limit=1),
    lambda r: r['receipts'].pop(),
    lambda r: r['receipts'][0].update(fingerprint='changed'),
    lambda r: r['receipts'][0]['outcome'].update(command_id='other'),
    lambda r: r['receipts'][0]['outcome'].update(revision=9999),
    lambda r: r.update(match_id=uuid4().hex),
    lambda r: r['receipts'][0].update(extra='not-supported'),
])
async def test_inconsistent_receipt_view_fails_before_registration(corrupt):
    source, game = await create_receipted_game('marriage')
    host = GameHost(source.rooms, Delivery())
    try:
        rows = receipt_view(game)
        corrupt(rows)
        with pytest.raises(CheckpointError):
            rebuild_hosted_game(host, capture_checkpoint(game, table_revision=1), receipt_snapshot=rows)
        assert host.tables == {} and host.games == {}
    finally:
        await source.close()
        await host.close()


async def test_receipt_capacity_and_terminal_status_lookup_are_preserved():
    source, game = await create_receipted_game('marriage')
    host = GameHost(source.rooms, Delivery())
    try:
        game.commands.receipt_limit = len(game.commands.receipts)
        rows = receipt_view(game)
        active = install_for_test(host, rebuild_hosted_game(host, capture_checkpoint(game, table_revision=1), receipt_snapshot=rows))
        with pytest.raises(HTTPException) as error:
            await host.action('room', 'u0', GameAction(match_id=game.match_id, command_id='new',
                expected_revision=engine_state(game).revision, command='DRAW_CARD', payload={'source': 'stock'}))
        assert error.value.status_code == 409
        row = rows['receipts'][0]
        assert (await host.action('room', row['actor_id'], GameAction(**row['request'])))['action_ack'] == row['outcome']
        game.ended = True
        game.table.phase = 'ENDED'
        ended = rebuild_hosted_game(host, capture_checkpoint(game, table_revision=2), receipt_snapshot=rows).game
        request = GameAction(**row['request'])
        assert lookup_recovered_receipt(ended, row['actor_id'], request) == row['outcome']
        with pytest.raises(CommandAccessError):
            lookup_recovered_receipt(ended, row['actor_id'], request.model_copy(update={'match_id': uuid4().hex}))
        assert host.games['room'] is active  # Rebuilding ended state did not replace a live table.
    finally:
        await host.close()
        await source.close()


async def test_flush_finished_roster_and_replacement_can_start_next_round():
    source, game = await make_host('flush')
    host = GameHost(source.rooms, Delivery())
    try:
        game.flush_seats = {'u0': 1, 'u1': 8}
        await start(source, game)
        for command in ('DEAL_CARDS', 'SKIP_CUT', 'FOLD'):
            await action(source, game, command)
        await source._release_seat(game, 'u1')
        source._seat_user(game, 'u2')
        restored = install_for_test(host, rebuild_hosted_game(host, capture_checkpoint(game, table_revision=3),
                                                            receipt_snapshot=receipt_view(game)))
        assert dict(restored.flush_target.seat_by_user) == {'u0': '1', 'u1': '8'}
        assert restored.users == ['u0', 'u2']
        await start(host, restored)
        assert restored.flush_target.adapter.seat_ids == ('1', '9')
        assert restored.flush_target.adapter.checkpoint().get_state().round_number == 2
        assert game.flush_target.adapter.checkpoint().get_state().round_number == 1
    finally:
        await source.close()
        await host.close()


async def test_two_callbreak_tables_authorize_independently_after_recovery():
    first, a = await make_host('callbreak')
    second, b = await make_host('callbreak')
    host = GameHost(first.rooms, Delivery())
    try:
        await start(first, a)
        await start(second, b)
        restored = [install_for_test(host, rebuild_hosted_game(host, capture_checkpoint(g, table_revision=0),
                                                             receipt_snapshot=receipt_view(g))) for g in (a, b)]
        for game in restored:
            await action(host, game, 'SHUFFLE_DECK')
            assert engine_state(game).revision > 1
        assert host.games['room'] is restored[1]
    finally:
        await first.close()
        await second.close()
        await host.close()


@pytest.mark.parametrize('kind,engine', [('marriage', MarriageGameEngine), ('flush', FlushGameEngine)])
async def test_engine_restore_copies_rng_and_rejects_wrong_state_type(kind, engine):
    host, game = await make_host(kind)
    try:
        await start(host, game)
        rng = Random(42)
        before = rng.getstate()
        restored = engine.from_state(engine_state(game), rng=rng)
        assert rng.getstate() == before and restored.get_state() == engine_state(game)
        restored._rng.random()
        assert rng.getstate() == before
        with pytest.raises(ValueError): engine.from_state({})
        with pytest.raises(ValueError): engine.from_state(engine_state(game), rng=object())
    finally:
        await host.close()
