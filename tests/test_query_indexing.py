"""Production SQL regressions for bounded reads and migration 27."""
from contextlib import asynccontextmanager
from uuid import UUID

import pytest

from app.database import MIGRATIONS
from app.durable_games.queries import PostgresHostedQueries
from app.durable_games.store import DurableGameConflict
from app.ledger.store import PostgresLedgerStore
from app.players.store import PostgresPlayerStore
from pglite_support import PGlitePool
from test_checkpoint_store import database


class RecordedPool:
    def __init__(self, pool):
        self.pool, self.calls = pool, []

    @asynccontextmanager
    async def connection(self):
        async with self.pool.connection() as connection:
            recorder = self

            class Connection:
                def transaction(self):
                    return connection.transaction()

                async def execute(self, sql, params=()):
                    recorder.calls.append((sql, params))
                    return await connection.execute(sql, params)
            yield Connection()


async def test_lobby_batches_members_without_leaking_other_rooms(database):
    pool, _, _, users = database
    for i in range(20):
        await pool.execute("""INSERT INTO rooms(id,creator_id,name,visibility)
            VALUES (%s,%s,'Empty','public')""", (f'empty-{i:02}', UUID(int=2)))
    recorded = RecordedPool(pool)
    result = await PostgresHostedQueries(recorded).lobby(users[0])
    assert len(result['items']) == 21
    assert all(not r['members'] and not r['member_previews']
               for r in result['items'] if r['room_id'].startswith('empty-'))
    assert result['items'][-1]['members'] == users
    assert len([sql for sql, _ in recorded.calls if not sql.startswith('SET ')]) == 2
    # Preserve the per-room limit even after replacing individual reads.
    await pool.execute("""INSERT INTO users(id,kind)
        SELECT md5(i::text)::uuid,'account' FROM generate_series(1,1001) i""")
    await pool.execute("""INSERT INTO room_memberships(room_id,user_id)
        SELECT 'empty-00',md5(i::text)::uuid FROM generate_series(1,1001) i""")
    with pytest.raises(DurableGameConflict, match='membership limit'):
        await PostgresHostedQueries(recorded).lobby(users[0])


async def test_settlement_batches_group_children_in_three_reads(database):
    pool, _, _, users = database
    for i in range(1, 4):
        await pool.execute("""INSERT INTO settlement_batches
            (batch_id,room_id,table_id,scope,status,created_by,idempotency_key)
            VALUES (%s,'room',%s,'table','OPEN',%s,%s)""",
            (UUID(int=i), UUID(int=100), UUID(int=1), str(i)))
        if i == 3:
            continue  # Empty batches must remain visible.
        await pool.execute("""INSERT INTO ledger_games(game_id,room_id,table_id,game_type)
            VALUES (%s,'room',%s,'callbreak')""", (UUID(int=i), UUID(int=100)))
        await pool.execute("INSERT INTO settlement_games(batch_id,game_id) VALUES (%s,%s)",
                           (UUID(int=i), UUID(int=i)))
        await pool.execute("""INSERT INTO settlement_transfers
            (transfer_id,batch_id,payer_id,payee_id,amount,status)
            VALUES (%s,%s,%s,%s,10,'OPEN')""",
            (UUID(int=i), UUID(int=i), UUID(int=1), UUID(int=2)))
    recorded = RecordedPool(pool)
    result = await PostgresLedgerStore(recorded).room_batches('room')
    assert len(recorded.calls) == 3
    by_id = {row['batch_id']: row for row in result}
    for i in (1, 2):
        assert by_id[str(UUID(int=i))]['games'] == [UUID(int=i).hex]
        assert [t['transfer_id'] for t in by_id[str(UUID(int=i))]['transfers']] == [str(UUID(int=i))]
    assert by_id[str(UUID(int=3))]['games'] == []
    assert by_id[str(UUID(int=3))]['transfers'] == []
    recorded.calls.clear()
    assert await PostgresLedgerStore(recorded).room_batches('missing') == []
    assert len(recorded.calls) == 1


async def test_upgrade_preserves_directory_results_and_uses_search_indexes():
    pool = await PGlitePool.open()
    try:
        for version, sql in MIGRATIONS:
            if version < 27:
                await pool.execute(sql, script=True)
        await pool.execute("""INSERT INTO users(id,kind)
            SELECT md5(i::text)::uuid,'account' FROM generate_series(1,20000) i""")
        await pool.execute("""INSERT INTO user_profiles(user_id,display_name)
            SELECT md5(i::text)::uuid,'Player '||i FROM generate_series(1,20000) i""")
        await pool.execute("""INSERT INTO account_credentials(user_id,username,password_salt,password_hash)
            SELECT md5(i::text)::uuid,'player'||i,''::bytea,''::bytea FROM generate_series(1,20000) i""")
        # Both branches match player 42; another player's display name also matches.
        await pool.execute("""UPDATE user_profiles SET display_name='PLAYER42'
            WHERE user_id IN (md5('42')::uuid,md5('43')::uuid)""")
        actor = 'user-' + str((await pool.execute("SELECT md5('1')::uuid")).rows[0][0])
        recorded = RecordedPool(pool)
        store = PostgresPlayerStore(recorded)
        before = await store.find_exact(actor, 'PlAyEr42')
        assert len(before) == 2 and before[0]['username'] == 'player42'
        await pool.execute(dict(MIGRATIONS)[27], script=True)
        await pool.execute('ANALYZE', script=True)
        assert await store.find_exact(actor, 'PlAyEr42') == before
        sql, params = recorded.calls[-1]
        plan = await pool.execute('EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ' + sql, params)
        rendered = str(plan.rows)
        assert 'user_profiles_display_name_lower_idx' in rendered
        assert 'account_credentials_username_lower_idx' in rendered
        assert len(await store.find_exact(before[0]['user_id'], 'player42')) == 1
        assert await store.find_exact(actor, 'player4') != before  # Still exact, not prefix matching.
    finally:
        await pool.close()
