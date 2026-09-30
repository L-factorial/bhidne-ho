"""Read-only preflight against the complete migrated application schema."""
from dataclasses import asdict
from uuid import UUID, uuid4

import pytest

from app.account_deletion.inventory import inspect_account
from app.auth.postgres import PostgresAuthService
from test_account_recovery import recovery_database


async def inspect(pool, user):
    async with pool.connection() as connection:
        return await inspect_account(connection, user)


async def test_inventory_is_private_and_does_not_revoke_or_delete(recovery_database):
    pool = recovery_database
    auth = PostgresAuthService(pool)
    account = await auth.sign_up('delete_candidate', 'original-password', email='private@example.test')
    result = await inspect(pool, account.user_id)
    assert result.account_kind == 'account' and result.password_account
    assert result.dependencies == ()
    assert 'private@example.test' not in str(asdict(result))
    assert account.token not in str(asdict(result))
    assert (await auth.authenticate(account.token)).user_id == account.user_id
    assert (await auth.sign_in('delete_candidate', 'original-password')).user_id == account.user_id


async def test_inventory_counts_only_the_subjects_dependencies(recovery_database):
    pool = recovery_database
    auth = PostgresAuthService(pool)
    a = await auth.sign_up('deletion_a', 'original-password')
    b = await auth.sign_up('deletion_b', 'original-password')
    aid, bid = UUID(a.user_id[5:]), UUID(b.user_id[5:])
    await pool.execute("INSERT INTO rooms(id,creator_id,name,visibility) VALUES ('deletion-room',%s,'Private room','private')", (aid,))
    await pool.execute("INSERT INTO active_table_players(user_id,table_id,match_id,room_id,game_type,seat) VALUES (%s,%s,%s,'deletion-room','callbreak',1)", (aid, uuid4(), uuid4()))
    await pool.execute('INSERT INTO direct_messages(id,sender_id,recipient_id,text) VALUES (%s,%s,%s,%s)', (uuid4(), aid, bid, 'Sensitive message'))
    inventory = await inspect(pool, a.user_id)
    assert inventory.owned_rooms == inventory.reserved_tables == inventory.authored_messages == 1
    assert inventory.dependencies == ('active_participation', 'room_ownership')
    other = await inspect(pool, b.user_id)
    assert other.owned_rooms == other.reserved_tables == other.authored_messages == 0
    assert 'Sensitive message' not in str(asdict(inventory))
    assert (await pool.execute('SELECT count(*) FROM direct_messages')).rows == [(1,)]


async def test_inventory_identifies_social_and_guest_proof_requirements(recovery_database):
    pool = recovery_database
    auth = PostgresAuthService(pool)
    guest = await auth.issue_guest()
    result = await inspect(pool, guest.user_id)
    assert result.account_kind == 'guest' and not result.password_account
    assert result.providers == ()
    await pool.execute("INSERT INTO external_identities(provider,provider_subject,user_id,email) VALUES ('apple','private-subject',%s,'private@relay.example')", (UUID(guest.user_id[5:]),))
    result = await inspect(pool, guest.user_id)
    assert result.providers == ('apple',)
    assert result.dependencies == ('provider_revocation',)
    assert 'private-subject' not in str(asdict(result))


async def test_inventory_missing_and_invalid_identity(recovery_database):
    assert await inspect(recovery_database, f'user-{uuid4()}') is None
    with pytest.raises(ValueError):
        await inspect(recovery_database, 'not-an-identity')


async def test_inventory_surfaces_pending_commands_and_unsettled_history(recovery_database):
    pool = recovery_database
    auth = PostgresAuthService(pool)
    a = await auth.sign_up('deletion_history_a', 'original-password')
    b = await auth.sign_up('deletion_history_b', 'original-password')
    aid, bid = UUID(a.user_id[5:]), UUID(b.user_id[5:])
    game, table, batch, lane, transfer = (uuid4() for _ in range(5))
    await pool.execute("INSERT INTO rooms(id,creator_id,name,visibility) VALUES ('history-room',%s,'History','private')", (bid,))
    await pool.execute("INSERT INTO ledger_games(game_id,room_id,table_id,game_type) VALUES (%s,'history-room',%s,'callbreak')", (game, table))
    await pool.execute('INSERT INTO game_ledger_entries(game_id,player_id,amount) VALUES (%s,%s,10)', (game, aid))
    await pool.execute("INSERT INTO settlement_batches(batch_id,room_id,table_id,scope,status,created_by,idempotency_key) VALUES (%s,'history-room',%s,'table','OPEN',%s,'test')", (batch, table, bid))
    await pool.execute("INSERT INTO settlement_transfers(transfer_id,batch_id,payer_id,payee_id,amount,status) VALUES (%s,%s,%s,%s,10,'OPEN')", (transfer, batch, aid, bid))
    await pool.execute("INSERT INTO command_lanes(lane_id,kind,room_id,enqueued_sequence) VALUES (%s,'room','history-room',1)", (lane,))
    await pool.execute("INSERT INTO command_inbox(lane_id,sequence,actor_id,command_id,command,payload,request_fingerprint) VALUES (%s,1,%s,'test','leave-room','{}','test')", (lane, a.user_id))
    result = await inspect(pool, a.user_id)
    assert result.pending_commands == result.ledger_entries == result.unsettled_transfers == 1
    assert result.dependencies == ('queued_commands', 'shared_ledger')
    assert (await auth.authenticate(a.token)).user_id == a.user_id
