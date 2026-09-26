"""Pure checkpoint recovery must preserve domain facts, not process resources."""
from copy import deepcopy
from dataclasses import replace
import hashlib
import json
from uuid import uuid4

import pytest

from app.durable_games.checkpoints import (
    CheckpointError, canonical_json, capture_checkpoint, decode_checkpoint, restore_table_state,
)
from app.multiplayer.room_service import RoomService
from app.multiplayer.table import SeatOffer
from app.test_games.http import GameAction
from app.test_games.service import HostedGame, TestGameService as GameHost
from callbreak import GameQuery
from flush.queries import player_view as flush_view
from marriage.queries import player_view as marriage_view


class Delivery:
    async def broadcast(self, *args): pass
    async def send_to_room_user(self, *args): pass


async def make_host(kind, count=None):
    count = count or (4 if kind == 'callbreak' else 2)
    rooms = RoomService()
    for i in range(count + 1):
        await rooms.join('room', f'u{i}')
    host = GameHost(rooms, Delivery())
    waiting = await host.create('room', 'u0', count, kind)
    for i in range(1, count):
        await host.join('room', f'u{i}', waiting['match_id'])
    game = host.games['room']
    if kind == 'marriage':
        game.marriage_scoring = replace(game.marriage_scoring, initial_tunnela_declaration=False)
    return host, game


async def start(host, game):
    if game.game_type != 'callbreak':
        await host.table_command('room', 'u0', game.match_id, 'lock')
    await host.start('room', 'u0', game.match_id, **({'rules_revision': 0} if game.game_type == 'flush' else {}))


async def action(host, game, command, payload=None, user=None):
    state = engine_state(game)
    if user is None:
        if game.game_type == 'callbreak':
            user = game.users[state.current_player - 1]
        else:
            seat = state.config.player_ids[state.current_seat]
            user = (next(u for u, n in game.flush_seats.items() if str(n) == seat)
                    if game.game_type == 'flush' else game.users[int(seat) - 1])
    await host.action('room', user, GameAction(match_id=game.match_id, command_id=uuid4().hex,
        expected_revision=state.revision, command=command, payload=payload or {}))


def engine_state(game):
    if game.game_type == 'callbreak': return game.state
    target = game.marriage_target if game.game_type == 'marriage' else game.flush_target
    return target.adapter.checkpoint().get_state() if target else None


def resign(value):
    """Exercise semantic validation independently from accidental corruption checks."""
    value['digest'] = hashlib.sha256(canonical_json(value['data']).encode()).hexdigest()
    return value


@pytest.mark.parametrize('kind,count', [('callbreak', 4), ('callbreak', 5), ('marriage', 2), ('flush', 2)])
async def test_waiting_and_active_engines_round_trip_without_side_effects(kind, count):
    host, game = await make_host(kind, count)
    try:
        waiting = capture_checkpoint(game, table_revision=1)
        assert decode_checkpoint(json.loads(json.dumps(waiting))).engine_state is None
        await start(host, game)
        commands = {'callbreak': ['SHUFFLE_DECK', 'SKIP_CUT', 'START_DISTRIBUTION'],
                    'marriage': ['DRAW_CARD'], 'flush': ['DEAL_CARDS', 'SKIP_CUT']}
        for command in commands[kind]:
            await action(host, game, command, {'source': 'stock'} if kind == 'marriage' else None)
            before = engine_state(game)
            events_before = deepcopy(game.table.events)
            record = capture_checkpoint(game, table_revision=7)
            decoded = decode_checkpoint(json.loads(json.dumps(record)))
            assert decoded.engine_state == before
            assert engine_state(game) is before
            assert game.table.events == events_before
            assert decoded.record.data.table_revision == 7
        if kind == 'callbreak':
            for seat in before.config.players:
                assert GameQuery(decoded.engine_state).get_player_view(seat) == GameQuery(before).get_player_view(seat)
        else:
            view = marriage_view if kind == 'marriage' else flush_view
            for seat in before.config.player_ids:
                assert view(decoded.engine_state, seat) == view(before, seat)
        # The checkpoint is trusted/private, never a transport projection. Mutating
        # a returned JSON object must not mutate the live host or decoded state.
        record['data']['host']['users'].append('intruder')
        assert 'intruder' not in game.users
        assert 'intruder' not in decoded.record.data.host.users
        assert 'receipts' not in record['data']['host']
        assert 'durable_ownership' not in record['data']['host']
    finally:
        await host.close()


async def test_marriage_terminal_events_keep_their_exact_types():
    host, game = await make_host('marriage')
    try:
        await start(host, game)
        await action(host, game, 'FOLD', user='u1')
        before = engine_state(game)
        record = capture_checkpoint(game, table_revision=2)
        restored = decode_checkpoint(record).engine_state
        assert restored == before
        assert [type(e) for e in restored.history] == [type(e) for e in before.history]
        assert 'PlayerFolded' in record['data']['engine']['history_types']
        bad = deepcopy(record)
        i = bad['data']['engine']['history_types'].index('PlayerFolded')
        bad['data']['engine']['history_types'][i] = 'PlayerSawMaal'
        with pytest.raises(CheckpointError): decode_checkpoint(resign(bad))
    finally:
        await host.close()


def test_lobby_checkpoint_preserves_offers_votes_invitations_and_empty_seats():
    game = HostedGame('room', 4, ['u0', 'u1', 'u2', 'u3'])
    game.table.next_seats = ['u0', None, 'u2', None]
    game.table.queue = ['u4', 'u5']
    game.departed = {'u1', 'u3'}
    game.table.releases = {2: 'u1', 4: 'u3'}
    offer = SeatOffer(uuid4().hex, game.match_id, 2, 'u1', 'u4', 100.0, 130.0)
    game.table.offers[offer.offer_id] = offer
    game.table.emit('SEAT_OFFERED', offer_id=offer.offer_id)
    game.table.published_sequence = 1
    game.rule_proposal = {'id': uuid4().hex, 'match_id': game.match_id, 'voters': list(game.users),
                          'accepted': ['u0'], 'status': 'PENDING', 'proposed': {'weak_hand_enabled': False}}
    invitation = {'id': uuid4().hex, 'room_id': 'room', 'match_id': game.match_id,
                  'recipient_id': 'u5', 'status': 'accepted'}
    record = capture_checkpoint(game, table_revision=9, invitations=[invitation])
    decoded = decode_checkpoint(record).record.data
    assert decoded.table.next_seat_count == 4
    assert [(p.user_id, p.seat, p.queue_position) for p in decoded.positions] == [
        ('u0', 1, None), ('u2', 3, None), ('u4', None, 1), ('u5', None, 2)]
    assert decoded.table.releases == {'2': 'u1', '4': 'u3'}
    assert decoded.table.offers[0].expires_at == 130.0
    assert decoded.host.rule_proposal == game.rule_proposal
    assert decoded.invitations[0] == invitation
    assert capture_checkpoint(game, table_revision=9, invitations=[invitation]) == record
    restored_table = restore_table_state(decode_checkpoint(record))
    assert restored_table == game.table
    restored_table.offers[offer.offer_id].status = 'ACCEPTED'
    assert game.table.offers[offer.offer_id].status == 'PENDING'
    game.ended = True
    game.table.phase = 'ENDED'
    retired = decode_checkpoint(capture_checkpoint(game, table_revision=10))
    assert not any(p.seat for p in retired.record.data.positions)
    assert restore_table_state(retired) == game.table


async def test_flush_sparse_seat_ids_and_between_round_replacement_survive():
    host, game = await make_host('flush')
    try:
        # Two occupied seats; IDs are historical and not bounded by capacity.
        game.flush_seats = {'u0': 1, 'u1': 8}
        await start(host, game)
        for command in ('DEAL_CARDS', 'SKIP_CUT', 'FOLD'):
            await action(host, game, command)
        assert engine_state(game).status.value == 'finished'
        # The engine still holds this round's roster as the next one forms.
        await host._release_seat(game, 'u1')
        host._seat_user(game, 'u2')
        original = engine_state(game)
        value = capture_checkpoint(game, table_revision=5)
        decoded = decode_checkpoint(value)
        assert decoded.engine_state == original
        assert decoded.record.data.host.users == ('u0', 'u2')
        assert dict(decoded.record.data.host.flush_seats) == {'u0': 1, 'u1': 8, 'u2': 9}
        assert [p.seat for p in decoded.record.data.positions] == [1, 9]
        assert restore_table_state(decoded) == game.table
    finally:
        await host.close()


@pytest.mark.parametrize('corrupt', [
    lambda d: d.update(schema_version=2),
    lambda d: d.update(schema_version=True),
    lambda d: d['data'].update(unknown=True),
    lambda d: d['data']['positions'].append(deepcopy(d['data']['positions'][0])),
    lambda d: d['data']['positions'][0].update(queue_position=1),
    lambda d: d['data']['positions'][0].update(seat=99),
    lambda d: d['data']['table'].update(published_sequence=10),
    lambda d: d['data'].update(phase='STARTED'),
])
def test_bad_versions_positions_or_table_history_are_rejected(corrupt):
    value = capture_checkpoint(HostedGame('room', 4, ['u0']), table_revision=0)
    corrupt(value)
    with pytest.raises(CheckpointError): decode_checkpoint(resign(value))


def test_digest_and_unconverted_deadline_are_rejected():
    game = HostedGame('room', 4, ['u0'])
    value = capture_checkpoint(game, table_revision=0)
    value['data']['name'] = 'Changed'
    with pytest.raises(CheckpointError, match='digest'): decode_checkpoint(value)
    game.deadline = 123.0
    with pytest.raises(CheckpointError, match='absolute scheduled action'):
        capture_checkpoint(game, table_revision=0)


@pytest.mark.parametrize('kind', ['callbreak', 'marriage', 'flush'])
async def test_corrupt_revision_or_roster_rejected_even_with_valid_digest(kind):
    host, game = await make_host(kind)
    try:
        await start(host, game)
        value = capture_checkpoint(game, table_revision=1)
        value['data']['engine']['revision'] += 1
        with pytest.raises(CheckpointError): decode_checkpoint(resign(value))
        value = capture_checkpoint(game, table_revision=1)
        value['data']['host']['users'].pop()
        with pytest.raises(CheckpointError): decode_checkpoint(resign(value))
    finally:
        await host.close()
