from uuid import uuid4

import pytest
from app.durable_games.catalog import PostgresRoomCreation
from app.durable_games.queries import PostgresHostedQueries, QueryAccessDenied
from app.durable_games.store import DurableGameConflict
from test_checkpoint_store import database


async def test_atomic_room_creation_retry_tombstone_and_catalog_privacy(database):
    pool, store, fence, users = database
    catalog, queries = PostgresRoomCreation(pool), PostgresHostedQueries(pool)
    body = dict(command_id=uuid4().hex, name='Private', visibility='private')
    result = await catalog.create(users[0], body)
    assert await catalog.create(users[0], body) == result
    with pytest.raises(DurableGameConflict):
        await catalog.create(users[0], dict(body, name='Different'))
    assert (await queries.members(result['room_id'], users[0]))['items'] == users[:1]
    with pytest.raises(QueryAccessDenied):
        await queries.members(result['room_id'], users[-1])
    assert result['room_id'] not in [r['room_id'] for r in (await queries.catalog(users[-1]))['items']]
    await pool.execute('INSERT INTO deleted_rooms(id) VALUES (%s)', (result['room_id'],))
    assert await catalog.create(users[0], body) == result
    assert result['room_id'] not in [r['room_id'] for r in (await queries.catalog(users[0]))['items']]


async def test_member_pages_are_stable_and_catalog_pages_do_not_repeat(database):
    pool, store, fence, users = database
    queries = PostgresHostedQueries(pool)
    first = await queries.members('room', users[0], limit=2)
    second = await queries.members('room', users[0], after_user_id=first['next_user_id'], limit=2)
    assert first['items'] + second['items'] == users[:4]
    creator = PostgresRoomCreation(pool)
    for n in range(3):
        await creator.create(users[0], dict(command_id=uuid4().hex, name=f'Room {n}', visibility='public'))
    seen, cursor = [], ''
    while True:
        page = await queries.catalog(users[0], after_room_id=cursor, limit=2)
        seen.extend(r['room_id'] for r in page['items'])
        cursor = page['next_room_id']
        if cursor is None:
            break
    assert len(seen) == len(set(seen)) == 4


async def test_room_creation_invites_are_atomic_and_retryable(database):
    pool, store, fence, users = database
    creator, queries = PostgresRoomCreation(pool), PostgresHostedQueries(pool)
    body = dict(command_id=uuid4().hex, name='Invited', invitees=[users[-1]])
    result = await creator.create(users[0], body)
    assert await creator.create(users[0], body) == result
    invitations = (await queries.room_invitations(users[-1]))['items']
    assert len(invitations) == 1 and invitations[0]['room_id'] == result['room_id']
    assert (await queries.room_invitations(users[1]))['items'] == []
    invalid = dict(command_id=uuid4().hex, name='Invalid', invitees=[users[0]])
    with pytest.raises(ValueError):
        await creator.create(users[0], invalid)
    assert (await pool.execute('SELECT count(*) FROM rooms')).rows == [(2,)]
