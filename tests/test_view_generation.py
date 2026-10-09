from copy import deepcopy
from uuid import UUID

import pytest

from app.durable_games.checkpoint_store import PostgresCheckpointStore
from app.durable_games.checkpoints import capture_checkpoint
from app.durable_games.redis_presence import ConnectionPresence, PresenceObservation
from app.durable_games.view_generation import ViewGenerationWorker, projected_view
from app.durable_games.view_delta import apply_delta
from test_checkpoint_store import database, host_game, advance


class Presence:
    def __init__(self, users): self.users = users
    async def observe(self, kind, key):
        return PresenceObservation('observed', tuple(ConnectionPresence('one', str(i), u, key) for i,u in enumerate(self.users)))


@pytest.mark.parametrize('kind', ['callbreak', 'marriage', 'flush'])
async def test_worker_generates_exact_private_views_once_after_commit(database, kind):
    pool, _, fence, users = database
    store = PostgresCheckpointStore(pool, retain_view_transitions=True)
    host, game = await host_game(users, kind)
    try:
        before = capture_checkpoint(game, table_revision=0)
        await store.save(before, expected_revision=None, fence=fence)
        from app.durable_games.queries import PostgresHostedQueries
        initial_views = {}
        for actor in game.users:
            snapshot = (await PostgresHostedQueries(pool).room('room',actor,table_id=game.table.table_id))['snapshot']
            snapshot.pop('tables',None)
            snapshot.pop('can_end_table',None)  # HTTP-only room ownership permission.
            from fastapi.encoders import jsonable_encoder
            initial_views[actor] = jsonable_encoder(snapshot)
        receipt = await advance(host, game)
        after = capture_checkpoint(game, table_revision=1)
        await store.save(after, expected_revision=0, fence=fence, receipt=receipt)
        worker = ViewGenerationWorker(pool, Presence(game.users))
        claim, = await worker.claim()
        assert await worker.claim() == ()
        messages = await worker.generate(claim)
        for user,payload in messages:
            actor = f'user-{user}'
            assert payload['type'] == 'VIEW_DELTA'
            names = {u:u for u in game.users}
            base = projected_view(claim.before, actor, names)
            assert base == initial_views[actor]
            assert apply_delta(base, payload['delta'], game_id=game.match_id, revision=0) == projected_view(claim.after, actor, names)
            next_view=(await PostgresHostedQueries(pool).room('room',actor,table_id=game.table.table_id))['snapshot']
            assert payload['table_preview']==next(p for p in next_view['tables'] if p['table_id']==game.table.table_id)
        assert await worker.finish(claim, messages)
        assert not await worker.finish(claim, messages)
        assert (await pool.execute("SELECT count(*) FROM notification_outbox WHERE event_type='VIEW_DELTA'")).rows == [(len(game.users),)]
        await worker.prune()
        assert (await pool.execute('SELECT revision FROM delivery_checkpoints')).rows == [(1,)]
    finally:
        await host.close()


async def test_expired_claim_cannot_finish_and_next_transition_waits(database):
    pool, _, fence, users = database
    store = PostgresCheckpointStore(pool, retain_view_transitions=True)
    host, game = await host_game(users)
    try:
        await store.save(capture_checkpoint(game, table_revision=0), expected_revision=None, fence=fence)
        for revision in (1,2):
            game.name = f'Table {revision}'
            await store.save(capture_checkpoint(game, table_revision=revision), expected_revision=revision-1, fence=fence)
        worker = ViewGenerationWorker(pool, Presence(users[:2]))
        first, = await worker.claim()
        assert first.revision == 1
        assert await worker.claim() == ()
        await pool.execute("UPDATE view_generation_jobs SET claim_expires_at=clock_timestamp()-interval '1 second' WHERE claim_token IS NOT NULL")
        replacement, = await worker.claim()
        assert first.token != replacement.token
        assert not await worker.finish(first, [])
        assert await worker.finish(replacement, [])
        second, = await worker.claim()
        assert second.revision == 2
    finally:
        await host.close()
