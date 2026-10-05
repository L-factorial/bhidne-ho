from copy import deepcopy
import json
from pathlib import Path

import pytest

from app.durable_games.view_delta import DeltaError, apply_delta, canonical_view, make_delta, view_checksum


FIXTURE = Path(__file__).parents[1] / 'client/tests/fixtures/game-view-delta.json'


def test_shared_python_typescript_wire_fixture():
    case = json.loads(FIXTURE.read_text())
    assert canonical_view(case['before']) == case['canonical_before']
    assert make_delta(case['before'], case['after'], game_id='match', base_revision=10, revision=11) == case['delta']
    assert apply_delta(case['before'], case['delta'], game_id='match', revision=10) == case['after']


@pytest.mark.parametrize('old,new', [
    ({'a': 1}, {'a': True}), ({'a': [1, 2]}, {'a': [2]}),
    ({'a': {'x': 2}}, {'a': None}), ({'a': None}, {'a': {'x': 2}}),
    ({'a': 1, 'b': 2}, {'b': 3}), ({}, {}),
])
def test_patch_roundtrip_and_input_immutability(old, new):
    original = deepcopy(old)
    delta = make_delta(old, new, game_id='match', base_revision=1, revision=2)
    assert apply_delta(old, delta, game_id='match', revision=1) == new
    assert old == original


@pytest.mark.parametrize('failure', ['gap', 'identity', 'base', 'result', 'omission', 'overlap', 'prototype'])
def test_invalid_patch_never_mutates_original(failure):
    before, after = {'a': {'x': 1}, 'b': 1}, {'a': {'x': 2}, 'b': 2}
    delta = make_delta(before, after, game_id='match', base_revision=1, revision=2)
    if failure == 'gap': delta['base_revision'] = 0
    if failure == 'identity': delta['game_id'] = 'other'
    if failure == 'base': before['b'] = 5
    if failure == 'result': delta['checksum'] = '0' * 64
    if failure == 'omission': delta['operations'].pop()
    if failure == 'overlap': delta['operations'].append({'op': 'set', 'path': ['a'], 'value': {}})
    if failure == 'prototype': delta['operations'][0]['path'] = ['__proto__']
    original = deepcopy(before)
    with pytest.raises(DeltaError):
        apply_delta(before, delta, game_id='match', revision=1)
    assert before == original


@pytest.mark.parametrize('value', [float('nan'), float('inf'), 2**53, {'constructor': 1}, {'x': object()}])
def test_unsupported_view_fails_closed(value):
    with pytest.raises(DeltaError):
        view_checksum(value)


@pytest.mark.parametrize('kind', ['callbreak', 'marriage', 'flush'])
async def test_real_authorized_game_views_roundtrip(kind):
    from uuid import UUID
    from test_checkpoint_store import host_game, advance
    users = [f'user-{UUID(int=i)}' for i in range(1, 5)]
    host, game = await host_game(users, kind)
    try:
        # Compare the JSON view clients actually receive, not Python tuples/enums.
        before = {user: json.loads(json.dumps(host._snapshot(game, user))) for user in game.users}
        await advance(host, game)
        for user in game.users:
            after = json.loads(json.dumps(host._snapshot(game, user)))
            delta = make_delta(before[user], after, game_id=game.match_id, base_revision=1, revision=2)
            assert apply_delta(before[user], delta, game_id=game.match_id, revision=1) == after
    finally:
        await host.close()
