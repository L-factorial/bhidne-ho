"""Exercise the catalog SQL with real restrictive FKs (SQLite-compatible subset).

This lightweight harness verifies history retention and transactions without a
PostgreSQL daemon; it does not substitute for deployment PostgreSQL integration.
"""
from contextlib import asynccontextmanager
from datetime import datetime
import sqlite3
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.multiplayer.room_catalog import PostgresRoomCatalog
from app.multiplayer.room_service import RoomService


class SqlPool:
    def __init__(self):
        self.db = sqlite3.connect(':memory:')
        self.fail_membership_delete = False
        self.db.executescript('''
            PRAGMA foreign_keys=ON;
            CREATE TABLE rooms (id TEXT PRIMARY KEY, name TEXT, creator_id TEXT, visibility TEXT,
                created_at TEXT DEFAULT '2026-09-21T00:00:00+00:00');
            CREATE TABLE room_invitations (id TEXT PRIMARY KEY, room_id TEXT, inviter_id TEXT, recipient_id TEXT, status TEXT);
            CREATE TABLE deleted_rooms (id TEXT PRIMARY KEY);
            CREATE TABLE room_memberships (room_id TEXT REFERENCES rooms(id) ON DELETE CASCADE,
                user_id TEXT, PRIMARY KEY(room_id,user_id));
            CREATE TABLE games (id TEXT PRIMARY KEY, room_id TEXT REFERENCES rooms(id) ON DELETE RESTRICT);
            CREATE TABLE ledger_games (id TEXT PRIMARY KEY, room_id TEXT REFERENCES rooms(id) ON DELETE RESTRICT);
            CREATE TABLE settlement_batches (id TEXT PRIMARY KEY, room_id TEXT REFERENCES rooms(id) ON DELETE RESTRICT);
        ''')

    @asynccontextmanager
    async def connection(self):
        with self.db:
            yield self

    @asynccontextmanager
    async def transaction(self):
        with self.db:
            yield

    async def execute(self, sql, values=()):
        if self.fail_membership_delete and sql.startswith('DELETE FROM room_memberships'):
            raise RuntimeError('Database unavailable')
        cursor = self.db.execute(sql.replace('%s', '?'), tuple(str(value) for value in values))
        class Result:
            def convert(self, row):
                if row is None: return None
                return tuple(datetime.fromisoformat(value) if column[0] == 'created_at' else value
                             for column, value in zip(cursor.description, row))
            async def fetchone(self): return self.convert(cursor.fetchone())
            async def fetchall(self): return [self.convert(row) for row in cursor.fetchall()]
        return Result()


@pytest.mark.asyncio
async def test_delete_room_with_game_and_ledger_history_hides_it_without_destroying_history():
    pool = SqlPool()
    catalog = PostgresRoomCatalog(pool)
    owner = f'user-{uuid4()}'
    await catalog.create('played', 'Friday cards', owner, 'public')
    await catalog.create('visible', 'Next room', owner, 'public')
    await catalog.join('played', owner)
    for table in ['games', 'ledger_games', 'settlement_batches']:
        pool.db.execute(f"INSERT INTO {table} VALUES ('history', 'played')")
    pool.db.commit()
    with pytest.raises(sqlite3.IntegrityError):
        pool.db.execute("DELETE FROM rooms WHERE id='played'")
    pool.db.rollback()

    assert await catalog.delete('played') is True
    assert await catalog.deleted('played') is True
    assert await catalog.get('played') is None
    assert [room['room_id'] for room in await catalog.list()] == ['visible']
    assert await catalog.owned(owner) == {'visible'}
    assert await catalog.members('played') == set()
    assert await catalog.joined(owner) == set()
    await catalog.join('played', owner)
    assert await catalog.members('played') == set()
    for table in ['games', 'ledger_games', 'settlement_batches']:
        assert pool.db.execute(f'SELECT COUNT(*) FROM {table}').fetchone()[0] == 1
    assert await catalog.delete('played') is False
    assert await catalog.delete('missing') is False
    # A new service instance cannot revive the room through an old code.
    restarted = RoomService(PostgresRoomCatalog(pool))
    assert not await restarted.can_enter('played', owner, None)
    with pytest.raises(HTTPException) as error:
        await restarted.join('played', owner)
    assert error.value.status_code == 404


@pytest.mark.asyncio
async def test_failed_membership_cleanup_rolls_back_room_tombstone():
    pool = SqlPool()
    catalog = PostgresRoomCatalog(pool)
    owner = f'user-{uuid4()}'
    await catalog.create('room', 'Cards', owner, 'public')
    await catalog.join('room', owner)
    pool.fail_membership_delete = True
    with pytest.raises(RuntimeError):
        await catalog.delete('room')
    assert await catalog.deleted('room') is False
    assert (await catalog.get('room'))['name'] == 'Cards'
    assert await catalog.members('room') == {owner}
    pool.fail_membership_delete = False
    assert await catalog.delete('room') is True


@pytest.mark.asyncio
async def test_deleted_room_cannot_return_from_stale_in_memory_membership():
    pool = SqlPool()
    catalog = PostgresRoomCatalog(pool)
    service = RoomService(catalog)
    owner = f'user-{uuid4()}'
    await catalog.create('room', 'Cards', owner, 'public')
    await service.join('room', owner)
    # Simulate another catalog instance committing deletion before this cache clears.
    await PostgresRoomCatalog(pool).delete('room')
    assert await service.members('room') == []
    assert await service.list_rooms(owner) == []


@pytest.mark.asyncio
async def test_catalog_persists_private_invitations_and_visibility_updates():
    pool = SqlPool()
    catalog = PostgresRoomCatalog(pool)
    owner, recipient = f'user-{uuid4()}', f'user-{uuid4()}'
    await catalog.create('private-room', 'Private cards', owner, 'private')
    first = RoomService(catalog)
    await first.invite('private-room', owner, [recipient])
    restarted = RoomService(PostgresRoomCatalog(pool))
    invitation = (await restarted.invitations_for(recipient))[0]
    assert await restarted.can_enter('private-room', recipient, None)
    await restarted.answer_invitation(recipient, invitation['id'], True)
    assert await restarted.has_membership('private-room', recipient)
    assert await restarted.invitations_for(recipient) == []
    await restarted.update_visibility('private-room', owner, 'public')
    assert (await catalog.get('private-room'))['visibility'] == 'public'
    await restarted.update_visibility('private-room', owner, 'private')
    await restarted.leave('private-room', recipient)
    assert not await restarted.can_enter('private-room', recipient, None)
