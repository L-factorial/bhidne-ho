from dataclasses import replace
from uuid import UUID

from cryptography.fernet import Fernet, MultiFernet
import pytest

from app.auth.postgres import PostgresAuthService
from app.auth.recovery_delivery import RecoveryConfig, RecoveryRuntime
from app.auth.service import AuthenticationError
from test_account_recovery import recovery_database, allow_next
from test_distributed_platform import application, signup


def config():
    return RecoveryConfig('https://game.example.test', 'accounts@example.test', '127.0.0.1', 2525,
                          'local', '', '', MultiFernet([Fernet(Fernet.generate_key())]))


async def envelope(pool, runtime, purpose='verify_email'):
    row = (await pool.execute('SELECT envelope FROM recovery_mail_outbox WHERE purpose=%s', (purpose,))).rows[0]
    return runtime.decrypt(row[0])


async def test_signup_atomic_encrypted_delivery_retry_restart_and_single_use(recovery_database, monkeypatch):
    pool = recovery_database
    auth = PostgresAuthService(pool)
    runtime = RecoveryRuntime(pool, auth, config())
    user = await auth.sign_up('queue_player', 'old-password', email='player@example.test')
    payload = await envelope(pool, runtime)
    raw = (await pool.execute('SELECT envelope FROM recovery_mail_outbox')).rows[0][0]
    assert payload['token'].encode() not in raw and payload['email'].encode() not in raw
    assert len((await pool.execute('SELECT token_hash FROM account_recovery_challenges')).rows[0][0]) == 32
    delivered = []
    def fail(self, message):
        raise OSError('potentially sensitive SMTP text')
    monkeypatch.setattr(RecoveryConfig, 'send', fail)
    await runtime.deliver_one()
    assert (await pool.execute('SELECT attempts,lease_id FROM recovery_mail_outbox')).rows == [(1, None)]
    await pool.execute("UPDATE recovery_mail_outbox SET available_at=clock_timestamp()-interval '1 second'")
    restarted = RecoveryRuntime(pool, auth, runtime.config)
    monkeypatch.setattr(RecoveryConfig, 'send', lambda self, message: delivered.append(message))
    await restarted.deliver_one()
    assert delivered == [payload]
    assert (await pool.execute('SELECT count(*) FROM recovery_mail_outbox')).rows == [(0,)]
    await restarted.service.verify_email(payload['token'])
    assert (await restarted.service.email_status(user.user_id))['verified_email'] == 'player@example.test'


async def test_failed_enqueue_rolls_back_entire_signup(recovery_database, monkeypatch):
    pool = recovery_database
    auth = PostgresAuthService(pool)
    runtime = RecoveryRuntime(pool, auth, config())
    async def fail(*args):
        raise RuntimeError('queue write failed')
    monkeypatch.setattr(runtime, 'enqueue', fail)
    with pytest.raises(RuntimeError):
        await auth.sign_up('atomic_player', 'old-password', email='player@example.test')
    assert (await pool.execute('SELECT count(*) FROM account_credentials')).rows == [(0,)]
    assert (await pool.execute('SELECT count(*) FROM auth_sessions')).rows == [(0,)]


async def test_reset_requests_are_generic_queued_bounded_and_require_verified_contact(recovery_database):
    pool = recovery_database
    auth = PostgresAuthService(pool)
    runtime = RecoveryRuntime(pool, auth, config())
    user = await auth.sign_up('known_player', 'old-password', email='player@example.test')
    for name in ('unknown_player', 'known_player'):
        await runtime.request_reset(name, '127.0.0.1')
    assert (await pool.execute('SELECT count(*) FROM recovery_reset_requests')).rows == [(2,)]
    await runtime.process_reset(); await runtime.process_reset()
    assert (await pool.execute("SELECT count(*) FROM recovery_mail_outbox WHERE purpose='reset_password'")).rows == [(0,)]
    await runtime.service.verify_email((await envelope(pool,runtime))['token'])
    for _ in range(10):
        await runtime.request_reset('known_player', '127.0.0.1')
    assert (await pool.execute('SELECT count(*) FROM recovery_reset_requests')).rows == [(4,)]
    await runtime.process_reset()
    reset = await envelope(pool, runtime, 'reset_password')
    await runtime.service.reset_password(reset['token'], 'new-password')
    with pytest.raises(AuthenticationError):
        await auth.authenticate(user.token)
    assert (await auth.sign_in('known_player', 'new-password')).user_id == user.user_id


async def test_expiry_leases_and_exhaustion_remove_sensitive_payloads(recovery_database, monkeypatch):
    pool = recovery_database
    auth = PostgresAuthService(pool)
    runtime = RecoveryRuntime(pool, auth, config())
    await auth.sign_up('lease_player','old-password',email='lease@example.test')
    delivered = []
    monkeypatch.setattr(RecoveryConfig,'send',lambda self,payload: delivered.append(payload))
    await pool.execute("UPDATE recovery_mail_outbox SET lease_until=clock_timestamp()+interval '1 minute'")
    await runtime.deliver_one()
    assert not delivered
    await pool.execute("UPDATE recovery_mail_outbox SET lease_until=clock_timestamp()-interval '1 second'")
    await runtime.deliver_one()
    assert len(delivered) == 1
    for name, condition in [('expired_player', "expires_at=clock_timestamp()-interval '1 second'"),
                            ('exhausted_player', 'attempts=5')]:
        await auth.sign_up(name, 'old-password', email=name+'@example.test')
        await pool.execute('UPDATE recovery_mail_outbox SET '+condition)
        await runtime.deliver_one(); await runtime.cleanup()
        assert len(delivered) == 1
        assert (await pool.execute('SELECT count(*) FROM recovery_mail_outbox')).rows == [(0,)]


async def test_public_routes_status_proof_replace_remove_reset_and_no_token_response(recovery_database, monkeypatch):
    pool = recovery_database
    cfg = config()
    monkeypatch.setattr(RecoveryConfig,'from_environment',classmethod(lambda cls:cfg))
    # Deterministic worker ticks; lifecycle scheduling is checked separately.
    monkeypatch.setattr(RecoveryRuntime,'start',lambda self: async_noop())
    async with application(pool) as (client, app, server):
        runtime = app.state.recovery
        assert (await client.get('/auth/recovery/capabilities')).json() == {'enabled':True}
        assert (await client.get('/auth/recovery/email')).status_code == 401
        user, headers = await signup(client, 'route_player')
        pending = (await client.get('/auth/recovery/email',headers=headers)).json()
        assert pending['pending_email'] == 'signup@example.test' and pending['verified_email'] is None
        verification = await envelope(pool,runtime)
        response = await client.post('/auth/recovery/verify',json={'token':verification['token']})
        assert response.json() == {'verified':True} and response.headers['cache-control'] == 'no-store'
        assert (await client.post('/auth/recovery/verify',json={'token':verification['token']})).status_code == 400
        bad = await client.post('/auth/recovery/email',headers=headers,json={'email':'new@example.test','current_password':'wrong'})
        assert bad.status_code == 403 and bad.json()['detail']['code'] == 'recovery_password_incorrect'
        await allow_next(pool,'verify_email')
        response = await client.post('/auth/recovery/email',headers=headers,json={'email':'new@example.test','current_password':'long-password'})
        assert response.status_code == 202 and response.json() == {'accepted':True}
        pending = (await client.get('/auth/recovery/email',headers=headers)).json()
        assert pending['verified_email']=='signup@example.test' and pending['pending_email']=='new@example.test'
        for name in ('unknown_player','route_player'):
            response = await client.post('/auth/recovery/reset/request',json={'username':name})
            assert response.status_code == 202 and response.json() == {'accepted':True}
            assert response.headers['cache-control'] == 'no-store'
            await runtime.process_reset()
        reset = await envelope(pool,runtime,'reset_password')
        assert reset['email'] == 'signup@example.test'
        response = await client.post('/auth/recovery/reset/complete',json={'token':reset['token'],'password':'new-password'})
        assert response.json() == {'reset':True}
        assert (await client.get('/auth/me',headers=headers)).status_code == 401
        login = await client.post('/auth/signin',json={'username':'route_player','password':'new-password'})
        headers = {'Authorization':'Bearer '+login.json()['token']}
        response = await client.request('DELETE','/auth/recovery/email',headers=headers,json={'current_password':'new-password'})
        assert response.status_code == 204
        status = (await client.get('/auth/recovery/email',headers=headers)).json()
        assert status['verified_email'] is None and status['pending_email'] is None
        assert (await pool.execute('SELECT count(*) FROM account_recovery_challenges')).rows == [(0,)]
        assert (await pool.execute('SELECT count(*) FROM recovery_mail_outbox')).rows == [(0,)]


async def async_noop():
    pass


async def test_disabled_recovery_keeps_existing_login_and_signup_working(recovery_database):
    async with application(recovery_database) as (client,app,server):
        user,headers = await signup(client,'disabled_player')
        assert (await client.get('/auth/recovery/capabilities')).json() == {'enabled':False}
        assert (await client.get('/auth/me',headers=headers)).status_code == 200
        response = await client.post('/auth/recovery/reset/request',json={'username':'disabled_player'})
        assert response.status_code == 503 and response.headers['cache-control'] == 'no-store'


def test_config_requires_secure_origin_tls_and_keys(monkeypatch):
    monkeypatch.setenv('BHIDNE_HO_RECOVERY_ENABLED','1')
    with pytest.raises(ValueError):
        RecoveryConfig.from_environment()
    values={'PUBLIC_ORIGIN':'https://game.example.test','SMTP_HOST':'smtp.example.test','FROM':'accounts@example.test','KEYS':Fernet.generate_key().decode()}
    for key,value in values.items():
        monkeypatch.setenv('BHIDNE_HO_RECOVERY_'+key,value)
    assert RecoveryConfig.from_environment().tls == 'starttls'
    for key,bad in [('PUBLIC_ORIGIN','http://game.example.test'),('SMTP_TLS','local'),('KEYS','invalid'),('SMTP_PORT','65536')]:
        with monkeypatch.context() as m:
            m.setenv('BHIDNE_HO_RECOVERY_'+key,bad)
            with pytest.raises(ValueError): RecoveryConfig.from_environment()


def test_smtp_message_tls_and_fragment_link(monkeypatch):
    events=[]
    class SMTP:
        def __init__(self,*args,**kwargs): events.append('connect')
        def __enter__(self): return self
        def __exit__(self,*args): pass
        def starttls(self,**kwargs): events.append('tls')
        def login(self,*args): events.append('login')
        def send_message(self,message): events.append(message)
    monkeypatch.setattr('app.auth.recovery_delivery.smtplib.SMTP',SMTP)
    cfg=replace(config(),tls='starttls',username='sender',password='secret')
    cfg.send({'email':'player@example.test','purpose':'verify_email','token':'a'*43})
    assert events[:3] == ['connect','tls','login']
    assert 'https://game.example.test/#recovery=verify_email&token=' in events[3].get_content()
    assert events[3]['To'] == 'player@example.test'

async def test_worker_lifecycle_and_recipient_budget(recovery_database, monkeypatch):
    import asyncio
    pool = recovery_database
    auth = PostgresAuthService(pool)
    runtime = RecoveryRuntime(pool,auth,config())
    for index in range(11):
        await auth.sign_up(f'recipient_{index}','old-password',email='same@example.test')
    assert (await pool.execute('SELECT count(*) FROM recovery_mail_outbox')).rows == [(10,)]
    delivered = []
    monkeypatch.setattr(RecoveryConfig,'send',lambda self,payload: delivered.append(payload))
    await runtime.start()
    async with asyncio.timeout(5):
        while not delivered:
            await asyncio.sleep(.01)
    await runtime.stop()
    assert runtime.task is None

async def test_delivery_migration_preserves_existing_account_and_recovery_state():
    from app.database import MIGRATIONS
    from pglite_support import PGlitePool
    from app.auth.recovery import PostgresRecoveryService
    pool = await PGlitePool.open()
    try:
        for version,sql in MIGRATIONS:
            if version < 30: await pool.execute(sql,script=True)
        auth = PostgresAuthService(pool)
        user = await auth.sign_up('upgrade_player','old-password',email='upgrade@example.test')
        recovery = PostgresRecoveryService(pool)
        proof = await recovery.enroll_email(user.user_id,'old-password','upgrade@example.test')
        await recovery.verify_email(proof.token)
        before = {name:(await pool.execute('SELECT * FROM '+name)).rows for name in ('users','account_credentials','user_profiles','auth_sessions','account_recovery_contacts')}
        await pool.execute(dict(MIGRATIONS)[30],script=True)
        assert before == {name:(await pool.execute('SELECT * FROM '+name)).rows for name in before}
        assert (await auth.authenticate(user.token)).user_id == user.user_id
        assert (await auth.sign_in('upgrade_player','old-password')).user_id == user.user_id
    finally:
        await pool.close()
