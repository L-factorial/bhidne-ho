"""Checkpoint compatibility across Python hash seeds, without external services."""
from copy import deepcopy
from dataclasses import replace
import json
import os
from pathlib import Path
import subprocess
import sys

import pytest

from app.durable_games.checkpoints import CheckpointError, capture_checkpoint, decode_checkpoint
from marriage import DrawSource, Meld, MeldType, PlayerState, create_deck, validate_game_state
from test_hosted_checkpoints import make_host, start, resign


async def qualified_checkpoint(route='normal'):
    host, game = await make_host('marriage')
    try:
        await start(host, game)
        engine = game.marriage_target.adapter.checkpoint()
        engine.draw_card('1', DrawSource.STOCK)
        deck = create_deck()
        groups = tuple(tuple(deck[face + 52 * pack] for pack in range(3 if route == 'normal' else 2))
                       for face in range(3 if route == 'normal' else 7))
        selected = tuple(card for group in groups for card in group)
        remaining = tuple(card for card in deck if card not in selected)
        extra = 22 - len(selected)
        engine._state = replace(engine.get_state(), players=(
            PlayerState('1', selected + remaining[:extra]), PlayerState('2', remaining[extra:extra + 21])),
            stock=remaining[extra + 21:], discard=())
        validate_game_state(engine.get_state())
        melds = tuple(Meld(MeldType.TUNNELA if route == 'normal' else MeldType.DUBLEE,
                          tuple(c.card_id for c in group)) for group in groups)
        if route == 'normal': engine.show_initial_melds('1', melds)
        else: engine.show_dublees('1', melds)
        return capture_checkpoint(game, table_revision=7)
    finally:
        await host.close()


def child(code, seed, value=None):
    result = subprocess.run([sys.executable, '-c', code],
        input=json.dumps(value) if value is not None else None,
        capture_output=True, text=True, timeout=30,
        cwd=Path(__file__).resolve().parents[1],
        env={**os.environ, 'PYTHONHASHSEED': str(seed)})
    assert result.returncode == 0, result.stderr
    return json.loads(result.stdout)


@pytest.mark.parametrize('route', ['normal', 'dublee'])
def test_qualified_checkpoint_reads_across_processes_and_preserves_legacy_envelopes(route):
    checkpoint = child("""
import asyncio, json, sys
sys.path.insert(0, 'tests')
from test_marriage_checkpoint_processes import qualified_checkpoint
print(json.dumps(asyncio.run(qualified_checkpoint(json.load(sys.stdin)))))
""", 1, route)
    ids = checkpoint['data']['engine']['state']['players'][0]['committed_card_ids']
    assert len(ids) == (9 if route == 'normal' else 14) and ids == sorted(ids)
    legacy = deepcopy(checkpoint)
    legacy['data']['engine']['state']['players'][0]['committed_card_ids'].reverse()
    resign(legacy)  # Old writers legitimately signed whichever set order they emitted.
    reader = """
import json, sys
from copy import deepcopy
from app.durable_games.checkpoints import decode_checkpoint, _STATES
from app.durable_games.recovery import rebuild_hosted_game
from app.durable_games.queries import _ProjectionHost
value = json.load(sys.stdin)
before = deepcopy(value)
decoded = decode_checkpoint(value)
assert value == before
assert decoded.record.model_dump(mode='json') == before
rebuilt = rebuild_hosted_game(_ProjectionHost(None, None), value, receipt_snapshot={
    'match_id': value['data']['match_id'], 'revision': decoded.engine_state.revision,
    'receipt_count': 0, 'receipt_limit': 10000, 'receipts': []})
assert rebuilt.game.marriage_target.adapter.checkpoint().get_state() == decoded.engine_state
state = _STATES['marriage'].dump_python(decoded.engine_state, mode='json')
for player in state['players']:
    player['committed_card_ids'].sort()
print(json.dumps(state))
"""
    for value in (checkpoint, legacy):
        for seed in (1, 2, 3, 4):
            assert child(reader, seed, value) == checkpoint['data']['engine']['state']


@pytest.mark.parametrize('damage', ['duplicate', 'missing', 'foreign', 'revision', 'digest'])
async def test_unordered_compatibility_does_not_accept_invalid_checkpoints(damage):
    value = await qualified_checkpoint()
    engine = value['data']['engine']
    ids = engine['state']['players'][0]['committed_card_ids']
    if damage == 'duplicate': ids.append(ids[0])
    elif damage == 'missing': ids.pop()
    elif damage == 'foreign': ids[0] = 'not-an-owned-card'
    elif damage == 'revision': engine['revision'] += 1
    else: ids.reverse()
    if damage != 'digest': resign(value)
    with pytest.raises(CheckpointError):
        decode_checkpoint(value)
