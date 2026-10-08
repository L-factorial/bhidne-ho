"""Shared card-back authority, projection and additive checkpoint recovery."""
from copy import deepcopy
from dataclasses import replace
from typing import get_args

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from app.multiplayer.card_themes import CardThemeId, CardThemePayload, card_theme_controller
from app.test_games.http import CardThemeChange
from app.durable_games.checkpoints import CheckpointError, capture_checkpoint, decode_checkpoint
from app.durable_games.creation_executor import CreateTablePayload
from app.durable_games.recovery import rebuild_hosted_game
from test_hosted_checkpoints import make_host, start, engine_state, resign


@pytest.mark.parametrize('kind', ['callbreak', 'flush', 'marriage'])
async def test_creator_pregame_and_dealer_active_authority_with_shared_projection(kind):
    host, game = await make_host(kind)
    try:
        initial = host._snapshot(game, 'u0')
        assert initial['card_theme'] == 'kathmandu' and initial['can_change_card_theme']
        body = CardThemeChange(match_id=game.match_id, card_theme='everest')
        with pytest.raises(HTTPException) as denied:
            await host.change_card_theme('room', 'u1', body)
        assert denied.value.status_code == 403 and game.card_theme == 'kathmandu'
        await host.change_card_theme('room', 'u0', body)
        await start(host, game)
        controller = card_theme_controller(game)
        assert controller in game.users
        before = engine_state(game)
        for actor in ['u0', 'u1', f'u{game.capacity}']:
            view = host._snapshot(game, actor)
            assert view['card_theme'] == 'everest'
            assert view['can_change_card_theme'] == (actor == controller)
        next_body = CardThemeChange(match_id=game.match_id, card_theme='lumbini')
        observer = next(user for user in game.users if user != controller)
        with pytest.raises(HTTPException):
            await host.change_card_theme('room', observer, next_body)
        await host.change_card_theme('room', controller, next_body)
        assert engine_state(game) == before  # Cosmetic command doesn't advance the turn.
        assert {host._snapshot(game, user)['card_theme'] for user in game.users} == {'lumbini'}
        assert game.table.events[-1]['event'] == 'CARD_THEME_CHANGED'
        checkpoint = capture_checkpoint(game, table_revision=4)
        receipts = dict(match_id=game.match_id, revision=before.revision, receipt_count=0, receipt_limit=10000, receipts=[])
        recovered = rebuild_hosted_game(host, checkpoint, receipt_snapshot=receipts).game
        assert recovered.card_theme == 'lumbini'
        assert card_theme_controller(recovered) == controller
        game.ended = True
        with pytest.raises(HTTPException):
            await host.change_card_theme('room', controller, body)
    finally:
        await host.close()


async def test_dealer_rotation_and_departure_do_not_leave_old_dealer_in_control():
    host, game = await make_host('callbreak')
    try:
        await start(host, game)
        game.state = replace(game.state, initial_dealer=2, preparation=replace(game.state.preparation, dealer=2))
        assert card_theme_controller(game) == 'u1'
        game.state = replace(game.state, preparation=replace(game.state.preparation, dealer=3))
        assert card_theme_controller(game) == 'u2'
        game.departed.add('u2')
        assert card_theme_controller(game) == 'u0'
    finally:
        await host.close()


async def test_legacy_checkpoint_theme_default_only_after_digest_validation():
    host, game = await make_host('marriage')
    try:
        checkpoint = capture_checkpoint(game, table_revision=0)
        del checkpoint['data']['host']['card_theme']
        resign(checkpoint)
        decoded = decode_checkpoint(checkpoint)
        assert decoded.record.data.host.card_theme == 'kathmandu'
        # The normalized record itself has a correct digest for storage/recovery.
        decode_checkpoint(decoded.record.model_dump(mode='json'))
        corrupted = deepcopy(checkpoint)
        corrupted['data']['name'] = 'Changed without signing'
        with pytest.raises(CheckpointError, match='digest mismatch'):
            decode_checkpoint(corrupted)
    finally:
        await host.close()


def test_creation_and_change_allow_only_bundled_theme_ids_and_no_extra_fields():
    for theme in get_args(CardThemeId):
        assert CreateTablePayload(game_type='flush', capacity=2, card_theme=theme).card_theme == theme
        assert CardThemePayload(card_theme=theme).card_theme == theme
    for value in ['', '__proto__', 'toString', 'https://example.test/back.jpg', None, 1]:
        with pytest.raises(ValidationError):
            CardThemePayload(card_theme=value)
    with pytest.raises(ValidationError):
        CardThemePayload(card_theme='everest', controller='u0')
