import pytest
from app.auth.postgres import PostgresAuthService
from app.auth.recovery_delivery import RecoveryConfig, RecoveryRuntime
from test_account_recovery import recovery_database
from test_recovery_delivery import config, async_noop
from test_distributed_platform import application


async def verified_user(pool, runtime, auth, name, email):
    user = await auth.sign_up(name, 'original-password', email=email)
    async with pool.connection() as c:
        row = await (await c.execute("SELECT envelope FROM recovery_mail_outbox WHERE purpose='verify_email' AND user_id=%s", (user.user_id[5:],))).fetchone()
    await runtime.service.verify_email(runtime.decrypt(row[0])['token'])
    return user


async def test_only_current_verified_usernames_are_delivered_together(recovery_database, monkeypatch):
    pool = recovery_database
    auth = PostgresAuthService(pool)
    runtime = RecoveryRuntime(pool, auth, config())
    first = await verified_user(pool,runtime,auth,'first_player','player@example.test')
    await verified_user(pool,runtime,auth,'second_player','player@example.test')
    await auth.sign_up('unverified_player','original-password',email='player@example.test')
    await verified_user(pool,runtime,auth,'other_player','other@example.test')
    await runtime.request_username(' player@EXAMPLE.test ', '127.0.0.1')
    raw = (await pool.execute('SELECT envelope FROM recovery_reset_requests')).rows[0][0]
    assert b'player@example.test' not in raw
    await runtime.process_reset()
    await runtime.cleanup()
    assert (await pool.execute("SELECT count(*) FROM recovery_mail_outbox WHERE purpose='username_reminder'")).rows == [(1,)]
    sent = []
    monkeypatch.setattr(RecoveryConfig,'send',lambda self,payload:sent.append(payload))
    # Remove a non-anchor account's contact after queuing; delivery rechecks it.
    await pool.execute("DELETE FROM account_recovery_contacts WHERE user_id=(SELECT user_id FROM account_credentials WHERE username='second_player')")
    for _ in range(3): await runtime.deliver_one()
    reminder = next(p for p in sent if p['purpose']=='username_reminder')
    assert reminder['email']=='player@example.test'
    assert reminder['usernames']==['first_player']
    assert 'token' not in reminder
    assert (await auth.authenticate(first.token)).user_id == first.user_id
    assert (await auth.sign_in('first_player','original-password')).user_id == first.user_id


async def test_shared_mailbox_lists_all_verified_accounts(recovery_database, monkeypatch):
    pool=recovery_database;auth=PostgresAuthService(pool);runtime=RecoveryRuntime(pool,auth,config())
    for name in ['alice_player','bob_player']:
        await verified_user(pool,runtime,auth,name,'shared@example.test')
    await runtime.request_username('shared@example.test','127.0.0.1')
    await runtime.process_reset()
    sent=[]
    monkeypatch.setattr(RecoveryConfig,'send',lambda self,payload:sent.append(payload))
    await runtime.deliver_one()
    assert len(sent)==1 and sent[0]['usernames']==['alice_player','bob_player']
    assert (await pool.execute('SELECT count(*) FROM recovery_mail_outbox')).rows==[(0,)]


async def test_unknown_unverified_throttled_requests_have_identical_public_response(recovery_database,monkeypatch):
    cfg=config()
    monkeypatch.setattr(RecoveryConfig,'from_environment',classmethod(lambda cls:cfg))
    monkeypatch.setattr(RecoveryRuntime,'start',lambda self:async_noop())
    async with application(recovery_database) as (client,app,server):
        await app.state.auth.sign_up('pending_player','original-password',email='pending@example.test')
        await verified_user(recovery_database,app.state.recovery,app.state.auth,'verified_player','verified@example.test')
        for email in ['missing@example.test','pending@example.test','verified@example.test']*3:
            response=await client.post('/auth/recovery/username/request',json={'email':email})
            assert response.status_code==202 and response.json()=={'accepted':True}
            assert response.headers['cache-control']=='no-store'
        assert (await recovery_database.execute('SELECT count(*) FROM recovery_reset_requests')).rows==[(3,)]
        await app.state.recovery.process_reset();await app.state.recovery.process_reset()
        assert (await recovery_database.execute("SELECT count(*) FROM recovery_mail_outbox WHERE purpose='username_reminder'")).rows==[(0,)]
        assert (await client.post('/auth/recovery/username/request',json={'email':'invalid'})).status_code==422


async def test_reminder_retries_and_drops_email_after_contact_removed(recovery_database,monkeypatch):
    pool=recovery_database;auth=PostgresAuthService(pool);runtime=RecoveryRuntime(pool,auth,config())
    user=await verified_user(pool,runtime,auth,'retry_player','retry@example.test')
    await runtime.request_username('retry@example.test','127.0.0.1');await runtime.process_reset()
    def fail(self,payload): raise OSError('SMTP failed')
    monkeypatch.setattr(RecoveryConfig,'send',fail)
    await runtime.deliver_one()
    assert (await pool.execute('SELECT attempts FROM recovery_mail_outbox')).rows==[(1,)]
    await pool.execute("UPDATE recovery_mail_outbox SET available_at=clock_timestamp()-interval '1 second'")
    # Simulate contact removal before a retry; no reminder may be sent.
    await pool.execute('DELETE FROM account_recovery_contacts')
    sent=[]
    monkeypatch.setattr(RecoveryConfig,'send',lambda self,payload:sent.append(payload))
    await runtime.deliver_one()
    assert sent==[]
    assert (await pool.execute('SELECT count(*) FROM recovery_mail_outbox')).rows==[(0,)]


async def test_migration_31_preserves_existing_rows_and_queued_verification():
    from app.database import MIGRATIONS
    from pglite_support import PGlitePool
    pool=await PGlitePool.open()
    try:
        for version,sql in MIGRATIONS:
            if version<31: await pool.execute(sql,script=True)
        auth=PostgresAuthService(pool);runtime=RecoveryRuntime(pool,auth,config())
        user=await auth.sign_up('upgrade_player','original-password',email='upgrade@example.test')
        tables=['account_credentials','auth_sessions','recovery_mail_outbox','account_recovery_challenges']
        before={name:(await pool.execute('SELECT * FROM '+name)).rows for name in tables}
        await pool.execute(dict(MIGRATIONS)[31],script=True)
        assert before=={name:(await pool.execute('SELECT * FROM '+name)).rows for name in tables}
        assert (await auth.authenticate(user.token)).user_id==user.user_id
    finally: await pool.close()


def test_username_smtp_message_contains_names_without_reset_link(monkeypatch):
    sent=[]
    class SMTP:
        def __init__(self,*args,**kwargs): pass
        def __enter__(self): return self
        def __exit__(self,*args): pass
        def send_message(self,message): sent.append(message)
    monkeypatch.setattr('app.auth.recovery_delivery.smtplib.SMTP',SMTP)
    config().send({'purpose':'username_reminder','email':'shared@example.test','usernames':['alice_player','bob_player']})
    message=sent[0]
    assert message['To']=='shared@example.test'
    assert message['Subject']=='Your Bhidne Ho username'
    body=message.get_content()
    assert 'alice_player\nbob_player' in body and 'https://game.example.test/' in body
    assert 'token=' not in body and '#recovery=' not in body
