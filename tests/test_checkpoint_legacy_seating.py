"""Pre-seat-arrangement checkpoints must retain their original signed envelope."""
from copy import deepcopy
from uuid import UUID

import pytest

from app.durable_games.checkpoints import CheckpointError, capture_checkpoint, decode_checkpoint
from app.durable_games.recovery import rebuild_hosted_game
from app.multiplayer.room_service import RoomService
from app.test_games.service import TestGameService as GameHost
from test_hosted_checkpoints import make_host, start, resign
from test_checkpoint_store import database, host_game, Delivery


@pytest.mark.parametrize('kind', ['flush', 'marriage', 'callbreak'])
@pytest.mark.parametrize('started', [False, True])
async def test_legacy_seating_default_verifies_old_digest(kind, started):
    host, game = await make_host(kind)
    try:
        if started:
            await start(host, game)
        original = capture_checkpoint(game, table_revision=0)
        original['data']['table'].pop('seat_positions')
        resign(original)
        before = deepcopy(original)
        decoded = decode_checkpoint(original)
        assert decoded.record.data.table.seat_positions == {}
        assert original == before
        tampered = deepcopy(original)
        tampered['data']['name'] = 'Changed without resigning'
        with pytest.raises(CheckpointError, match='digest'):
            decode_checkpoint(tampered)
        tampered = deepcopy(original)
        tampered['data']['table']['seat_positions'] = {'u0': 1}
        with pytest.raises(CheckpointError, match='digest'):
            decode_checkpoint(tampered)
    finally:
        await host.close()


@pytest.mark.parametrize('kind', ['flush', 'marriage', 'callbreak'])
@pytest.mark.parametrize('started', [False, True])
async def test_legacy_seating_sql_recovery_preserves_bytes(database, kind, started):
    pool, store, fence, users = database
    host, game = await host_game(users, kind, started=started)
    recovered_host = GameHost(RoomService(), Delivery())
    try:
        original = capture_checkpoint(game, table_revision=0)
        await store.save(original, expected_revision=None, fence=fence)
        original['data']['table'].pop('seat_positions')
        resign(original)
        # Simulate the old writer's actual persisted bytes, not today's normalized save.
        await pool.execute("UPDATE table_recovery_state SET state=jsonb_set(state #- '{data,table,seat_positions}', '{digest}', to_jsonb(%s::text)) WHERE table_id=%s",
                           (original['digest'], UUID(str(game.table.table_id))))
        loaded = await store.load(game.table.table_id)
        assert loaded.checkpoint == original
        recovered = rebuild_hosted_game(recovered_host, loaded.checkpoint,
                                       receipt_snapshot=loaded.receipt_snapshot).game
        assert recovered.table.seat_positions == {}
        recovered.name = 'Recovered table'
        updated = capture_checkpoint(recovered, table_revision=1)
        await store.save(updated, expected_revision=0, fence=fence)
        assert (await store.load(game.table.table_id)).checkpoint == updated
    finally:
        await recovered_host.close()
        await host.close()
