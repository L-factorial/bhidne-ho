from uuid import UUID,uuid4
import pytest
from app.account_deletion.service import DeletionError
from test_account_recovery import recovery_database
from test_account_deletion import setup


async def test_owned_unfinished_table_and_live_watching_are_separate_blockers(recovery_database):
    from psycopg.types.json import Jsonb
    pool=recovery_database;auth,a,_,deletion=await setup(pool)
    b=await auth.sign_up('other_owner','original-password');uid=UUID(a.user_id[5:]);bid=UUID(b.user_id[5:])
    table,match,connection=uuid4(),uuid4(),uuid4()
    await pool.execute("INSERT INTO rooms(id,creator_id,name,visibility) VALUES ('owned-check',%s,'Owned','public')",(bid,))
    await pool.execute("INSERT INTO room_tables(table_id,room_id,name,game_type) VALUES (%s,'owned-check','My table','callbreak')",(table,))
    state={'data':{'host':{'users':[a.user_id]}}}
    await pool.execute("INSERT INTO table_recovery_state(table_id,match_id,schema_version,revision,phase,capacity,state) VALUES (%s,%s,1,0,'OPEN',4,%s)",(table,match,Jsonb(state)))
    result=await deletion.preflight(a.user_id)
    assert result['blockers'][0]==dict(kind='end_table',room_id='owned-check',room_name='Owned',table_id=str(table),name='My table')
    with pytest.raises(DeletionError,match='leave_games'):await deletion.request(a.user_id,password='original-password')
    state['data']['host']['users']=[b.user_id]
    await pool.execute('UPDATE table_recovery_state SET state=%s WHERE table_id=%s',(Jsonb(state),table))
    await pool.execute("INSERT INTO game_connection_leases(connection_id,room_id,user_id,table_id,alias_id,expires_at) VALUES (%s,'owned-check',%s,%s,'watch',clock_timestamp()+interval '1 minute')",(connection,uid,table))
    assert (await deletion.preflight(a.user_id))['blockers'][0]['kind']=='leave_table'
    await pool.execute('UPDATE game_connection_leases SET watching=false WHERE connection_id=%s',(connection,))
    assert (await deletion.preflight(a.user_id))['ready']


async def test_unclaimed_balances_block_but_zero_net_table_balance_does_not(recovery_database):
    pool=recovery_database;auth,a,recovery,deletion=await setup(pool)
    uid=UUID(a.user_id[5:]);table=uuid4();game=uuid4()
    await pool.execute("INSERT INTO rooms(id,creator_id,name,visibility) VALUES ('ledger-check',%s,'Ledger','public')",(uid,))
    await pool.execute("INSERT INTO ledger_games(game_id,room_id,table_id,game_type) VALUES (%s,'ledger-check',%s,'callbreak')",(game,table))
    await pool.execute('INSERT INTO game_ledger_entries(game_id,player_id,amount) VALUES (%s,%s,10)',(game,uid))
    before=await deletion.preflight(a.user_id)
    assert not before['ready'] and before['blockers'][0]['kind']=='settle_ledger'
    with pytest.raises(DeletionError,match='unsettled_ledger'):await deletion.email_request(a.user_id,'original-password')
    assert (await auth.authenticate(a.token)).user_id==a.user_id
    game2=uuid4()
    await pool.execute("INSERT INTO ledger_games(game_id,room_id,table_id,game_type) VALUES (%s,'ledger-check',%s,'callbreak')",(game2,table))
    await pool.execute('INSERT INTO game_ledger_entries(game_id,player_id,amount) VALUES (%s,%s,-10)',(game2,uid))
    assert (await deletion.preflight(a.user_id))['ready']


async def test_email_link_does_not_disable_account_and_new_blocker_rejects_final_confirmation(recovery_database):
    pool=recovery_database;auth,a,recovery,deletion=await setup(pool);uid=UUID(a.user_id[5:])
    proof=await recovery.service.enroll_email(a.user_id,'original-password','verified@example.test')
    await recovery.service.verify_email(proof.token)
    assert (await deletion.preflight(a.user_id))==dict(ready=True,blockers=[],email_verified=True)
    await deletion.email_request(a.user_id,'original-password')
    envelope=(await pool.execute("SELECT envelope FROM recovery_mail_outbox WHERE user_id=%s AND purpose='delete_account'",(uid,))).rows[0][0]
    token=recovery.decrypt(envelope)['token']
    assert (await auth.authenticate(a.token)).user_id==a.user_id
    await pool.execute("INSERT INTO rooms(id,creator_id,name,visibility) VALUES ('late-seat',%s,'Late','public')",(uid,))
    await pool.execute("INSERT INTO active_table_players(user_id,table_id,match_id,room_id,game_type,seat) VALUES (%s,%s,%s,'late-seat','callbreak',1)",(uid,uuid4(),uuid4()))
    assert not (await deletion.preflight(token=token))['ready']
    with pytest.raises(DeletionError,match='leave_games'):await deletion.request(token=token)
    assert (await auth.authenticate(a.token)).user_id==a.user_id
    await pool.execute('DELETE FROM active_table_players WHERE user_id=%s',(uid,))
    await deletion.request(token=token)
    assert (await pool.execute('SELECT deletion_pending FROM users WHERE id=%s',(uid,))).rows==[(True,)]


async def test_verified_email_required_and_write_fences_after_acceptance(recovery_database):
    from psycopg.errors import CheckViolation
    pool=recovery_database;auth,a,recovery,deletion=await setup(pool);uid=UUID(a.user_id[5:])
    await pool.execute('DELETE FROM account_recovery_contacts WHERE user_id=%s',(uid,))
    with pytest.raises(DeletionError,match='verify_email'):await deletion.email_request(a.user_id,'original-password')
    assert not (await deletion.preflight(a.user_id))['email_verified']
    await pool.execute("INSERT INTO rooms(id,creator_id,name,visibility) VALUES ('guard-room',%s,'Guard','public')",(uid,))
    await pool.execute("INSERT INTO room_memberships(room_id,user_id) VALUES ('guard-room',%s)",(uid,))
    game,table=uuid4(),uuid4()
    await pool.execute("INSERT INTO ledger_games(game_id,room_id,table_id,game_type) VALUES (%s,'guard-room',%s,'callbreak')",(game,table))
    await deletion.request(a.user_id,password='original-password')
    with pytest.raises(CheckViolation):await pool.execute('INSERT INTO game_ledger_entries(game_id,player_id,amount) VALUES (%s,%s,10)',(game,uid))
    with pytest.raises(CheckViolation):await pool.execute("INSERT INTO game_connection_leases(connection_id,room_id,user_id,table_id,alias_id,expires_at) VALUES (%s,'guard-room',%s,%s,'watch',clock_timestamp()+interval '1 minute')",(uuid4(),uid,table))


async def test_invalid_email_token_exposes_no_account_details(recovery_database):
    pool=recovery_database;_,a,_,deletion=await setup(pool)
    with pytest.raises(DeletionError,match='invalid_proof') as error:await deletion.preflight(token='x'*43)
    assert error.value.blockers is None


@pytest.mark.parametrize('status',['OPEN','MARKED_PAID','RESOLVED','CANCELLED'])
async def test_only_terminal_transfer_states_allow_deletion(recovery_database,status):
    pool=recovery_database;auth,a,_,deletion=await setup(pool)
    b=await auth.sign_up('settlement_other','original-password');uid,bid=UUID(a.user_id[5:]),UUID(b.user_id[5:]);batch,table=uuid4(),uuid4()
    await pool.execute("INSERT INTO rooms(id,creator_id,name,visibility) VALUES ('transfer-check',%s,'Transfers','public')",(bid,))
    await pool.execute("INSERT INTO settlement_batches(batch_id,room_id,table_id,scope,status,created_by,idempotency_key) VALUES (%s,'transfer-check',%s,'table','OPEN',%s,'once')",(batch,table,bid))
    await pool.execute('INSERT INTO settlement_transfers(transfer_id,batch_id,payer_id,payee_id,amount,status) VALUES (%s,%s,%s,%s,10,%s)',(uuid4(),batch,uid,bid,status))
    result=await deletion.preflight(a.user_id)
    assert result['ready'] == (status in ('RESOLVED','CANCELLED'))
    if not result['ready']:
        with pytest.raises(DeletionError,match='unsettled_ledger'):await deletion.request(a.user_id,password='original-password')
        assert (await auth.authenticate(a.token)).user_id==a.user_id
