"""Durable seat offers bind recipient, vacancy, deadline and original request."""
from contextlib import asynccontextmanager

import pytest
from psycopg import OperationalError

from app.durable_games.checkpoint_store import user_uuid
from app.durable_games.checkpoints import capture_checkpoint
from app.durable_games.executor import _DetachedHost
from app.durable_games.recovery import rebuild_hosted_game
from app.durable_games.seat_offers import expiry_id
from app.durable_games.store import DurableGameConflict
from app.durable_games.table_executor import TableLaneExecutor
from test_checkpoint_store import database
from test_rematch import completed, execute, request


async def action(database, game, inbox, lane, actor, name, payload=None):
    _, store, fence, _ = database
    body = request(await store.load(game.table.table_id), name)
    body['payload'] = payload or {}
    return await execute(inbox, lane, fence, actor, body)


async def offers(database, game):
    return (await database[1].load(game.table.table_id)).checkpoint['data']['table']['offers']


async def vacancy(database):
    host, game, inbox, lane, _ = await completed(database, 'callbreak')
    assert (await action(database, game, inbox, lane, database[3][0], 'leave-seat'))['status'] == 'accepted'
    return host, game, inbox, lane


async def test_fifo_decline_withdraw_accept_and_rematch(database):
    pool, store, fence, users = database
    host, game, inbox, lane, _ = await completed(database, 'callbreak')
    try:
        before = await store.load(game.table.table_id)
        for user in users[4:]:
            assert (await action(database, game, inbox, lane, user, 'join-queue'))['status'] == 'accepted'
        await action(database, game, inbox, lane, users[0], 'leave-seat')
        first = (await offers(database, game))[0]
        assert first['offered_to_player_id'] == users[4]
        assert (await action(database, game, inbox, lane, users[4], 'decline-seat', {'offer_id': first['offer_id']}))['status'] == 'accepted'
        second = (await offers(database, game))[1]
        assert second['offered_to_player_id'] == users[5]
        await action(database, game, inbox, lane, users[5], 'leave-queue')
        assert (await offers(database, game))[1]['status'] == 'CANCELLED'
        await action(database, game, inbox, lane, users[4], 'join-queue')
        third = (await offers(database, game))[2]
        accepted = await action(database, game, inbox, lane, users[4], 'accept-seat', {'offer_id': third['offer_id']})
        assert accepted['status'] == 'accepted'
        saved = await store.load(game.table.table_id)
        assert saved.checkpoint['data']['engine'] == before.checkpoint['data']['engine']
        assert saved.checkpoint['data']['host']['users'] == before.checkpoint['data']['host']['users']
        assert not saved.checkpoint['data']['table']['releases']
        assert (await pool.execute('SELECT status FROM scheduled_actions')).rows == [('cancelled',)] * 3
        assert (await pool.execute('SELECT count(*) FROM active_table_players WHERE user_id=%s', (user_uuid(users[4]),))).rows == [(1,)]
        assert (await action(database, game, inbox, lane, users[4], 'next-match'))['status'] == 'accepted'
        saved = await store.load(game.table.table_id)
        assert saved.checkpoint['data']['host']['users'] == [users[4], *users[1:4]]
    finally:
        await host.close()


async def test_invite_authority_payload_recipient_and_deadline(database):
    pool, store, fence, users = database
    host, game, inbox, lane = await vacancy(database)
    try:
        for actor, payload in [(users[3], {'seat_id': 1, 'recipient': users[4]}),
                               (users[0], {'seat_id': True, 'recipient': users[4]}),
                               (users[0], {'seat_id': 1, 'recipient': 'invalid'}),
                               (users[0], {'seat_id': 1, 'recipient': users[0]}),
                               (users[0], {'seat_id': 1, 'recipient': users[1]})]:
            before = await store.load(game.table.table_id)
            assert (await action(database, game, inbox, lane, actor, 'invite-seat', payload))['status'] == 'rejected'
            assert await store.load(game.table.table_id) == before
        assert (await action(database, game, inbox, lane, users[0], 'invite-seat', {'seat_id': 1, 'recipient': users[4]}))['status'] == 'accepted'
        offer = (await offers(database, game))[0]
        deadline = (await pool.execute('SELECT action_id,extract(epoch FROM due_at),payload FROM scheduled_actions')).rows[0]
        assert deadline[0] == expiry_id(offer['offer_id'])
        assert float(deadline[1]) == pytest.approx(offer['expires_at'])
        assert deadline[2] == {'offer_id': offer['offer_id']}
        before = await store.load(game.table.table_id)
        assert (await action(database, game, inbox, lane, users[5], 'accept-seat', {'offer_id': offer['offer_id']}))['status'] == 'rejected'
        assert await store.load(game.table.table_id) == before
        assert (await action(database, game, inbox, lane, users[4], 'accept-seat', {'offer_id': offer['offer_id']}))['status'] == 'accepted'
    finally:
        await host.close()


async def test_offer_transaction_rollback_and_unknown_commit(database, monkeypatch):
    pool, store, fence, users = database
    host, game, inbox, lane = await vacancy(database)
    try:
        before = await store.load(game.table.table_id)
        body = request(before, 'invite-seat')
        body['payload'] = {'seat_id': 1, 'recipient': users[4]}
        await inbox.enqueue(lane, users[0], body)
        with pytest.raises(DurableGameConflict, match='event batch'):
            await TableLaneExecutor(inbox, max_events=1).execute_one(lane, fence)
        assert await store.load(game.table.table_id) == before
        assert (await pool.execute('SELECT count(*) FROM scheduled_actions')).rows == [(0,)]
        transaction = pool.transaction
        @asynccontextmanager
        async def lost_commit():
            async with transaction(): yield pool
            raise OperationalError('lost response')
        with monkeypatch.context() as patch:
            patch.setattr(pool, 'transaction', lost_commit)
            with pytest.raises(OperationalError): await TableLaneExecutor(inbox).execute_one(lane, fence)
        after = await store.load(game.table.table_id)
        assert (await inbox.enqueue(lane, users[0], body)).outcome['status'] == 'accepted'
        assert await TableLaneExecutor(inbox).execute_one(lane, fence) is None
        assert await store.load(game.table.table_id) == after
        assert (await pool.execute('SELECT count(*) FROM scheduled_actions')).rows == [(1,)]
    finally:
        await host.close()


async def test_expired_offer_cannot_be_accepted_before_timer_dispatch(database):
    pool, store, fence, users = database
    host, game, inbox, lane = await vacancy(database)
    try:
        saved = await store.load(game.table.table_id)
        detached = _DetachedHost(8)
        rebuilt = detached.game = rebuild_hosted_game(detached, saved.checkpoint, receipt_snapshot=saved.receipt_snapshot).game
        rebuilt.table.offer_seconds = 0.000001
        revision = saved.checkpoint['data']['table_revision']
        await store.save(capture_checkpoint(rebuilt, table_revision=revision+1), expected_revision=revision, fence=fence)
        await action(database, game, inbox, lane, users[0], 'invite-seat', {'seat_id': 1, 'recipient': users[4]})
        offer = (await offers(database, game))[0]
        before = await store.load(game.table.table_id)
        assert (await action(database, game, inbox, lane, users[4], 'accept-seat', {'offer_id': offer['offer_id']}))['status'] == 'rejected'
        assert await store.load(game.table.table_id) == before
        assert (await pool.execute('SELECT status FROM scheduled_actions')).rows == [('pending',)]
    finally:
        await host.close()


async def test_multiple_vacancies_have_distinct_fifo_offers_and_stable_deadlines(database):
    pool, store, fence, users = database
    host, game, inbox, lane, _ = await completed(database, 'callbreak')
    try:
        for user in users[4:]: await action(database, game, inbox, lane, user, 'join-queue')
        for user in users[:2]: await action(database, game, inbox, lane, user, 'leave-seat')
        pending = await offers(database, game)
        assert [(o['seat_id'], o['offered_to_player_id']) for o in pending] == [(1, users[4]), (2, users[5])]
        deadlines = (await pool.execute('SELECT * FROM scheduled_actions ORDER BY generation')).rows
        # Other successful commands do not reissue or extend pending offers.
        await action(database, game, inbox, lane, users[0], 'leave-seat')
        assert await offers(database, game) == pending
        assert (await pool.execute('SELECT * FROM scheduled_actions ORDER BY generation')).rows == deadlines
        for offer in pending:
            assert (await action(database, game, inbox, lane, offer['offered_to_player_id'], 'accept-seat', {'offer_id': offer['offer_id']}))['status'] == 'accepted'
        # A replacement may itself release the next-match seat without changing history.
        assert (await action(database, game, inbox, lane, users[4], 'leave-seat'))['status'] == 'accepted'
        assert (await store.load(game.table.table_id)).checkpoint['data']['table']['releases'] == {'1': users[4]}
    finally:
        await host.close()


async def test_acceptance_conflict_preserves_offer_and_still_allows_decline(database):
    from test_checkpoint_store import host_game
    pool, store, fence, users = database
    host, game, inbox, lane = await vacancy(database)
    other_host = None
    try:
        await action(database, game, inbox, lane, users[0], 'invite-seat', {'seat_id': 1, 'recipient': users[4]})
        offer = (await offers(database, game))[0]
        other_host, other = await host_game(users[4:], 'marriage', started=False)
        await store.save(capture_checkpoint(other, table_revision=0), expected_revision=None, fence=fence)
        before = await store.load(game.table.table_id)
        assert (await action(database, game, inbox, lane, users[4], 'accept-seat', {'offer_id': offer['offer_id']}))['status'] == 'rejected'
        assert await store.load(game.table.table_id) == before
        assert (await pool.execute('SELECT status FROM scheduled_actions')).rows == [('pending',)]
        # Declining or withdrawing remains allowed while seated elsewhere.
        assert (await action(database, game, inbox, lane, users[4], 'decline-seat', {'offer_id': offer['offer_id']}))['status'] == 'accepted'
        assert (await pool.execute('SELECT status FROM scheduled_actions')).rows == [('cancelled',)]
    finally:
        await host.close()
        if other_host: await other_host.close()


async def test_acceptance_outbox_failure_keeps_vacancy_and_pending_deadline(database):
    pool, store, fence, users = database
    host, game, inbox, lane = await vacancy(database)
    try:
        await action(database, game, inbox, lane, users[0], 'invite-seat', {'seat_id': 1, 'recipient': users[4]})
        offer = (await offers(database, game))[0]
        before = await store.load(game.table.table_id)
        body = request(before, 'accept-seat')
        body['payload'] = {'offer_id': offer['offer_id']}
        await inbox.enqueue(lane, users[4], body)
        with pytest.raises(DurableGameConflict, match='event batch'):
            await TableLaneExecutor(inbox, max_events=1).execute_one(lane, fence)
        assert await store.load(game.table.table_id) == before
        assert (await pool.execute('SELECT status FROM scheduled_actions')).rows == [('pending',)]
        assert (await pool.execute('SELECT count(*) FROM active_table_players WHERE user_id=%s', (user_uuid(users[4]),))).rows == [(0,)]
        assert (await TableLaneExecutor(inbox).execute_one(lane, fence)).outcome['status'] == 'accepted'
    finally:
        await host.close()
