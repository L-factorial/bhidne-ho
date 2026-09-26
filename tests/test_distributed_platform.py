from contextlib import asynccontextmanager

import pytest
from httpx import ASGITransport, AsyncClient

from app.auth.postgres import PostgresAuthService
from app.durable_games.server import build_server
from app.main import create_app
from app.multiplayer.player_profiles import PostgresPlayerProfileService
from test_checkpoint_store import database
from test_redis_signals import Broker, SECRET


@asynccontextmanager
async def application(pool, **options):
    broker = Broker()
    broker.online = False
    server = build_server(pool, broker, internal_address='platform-test', signal_secret=SECRET,
        auth=PostgresAuthService(pool), allowed_origins={'https://game.test'}, **options)
    app = create_app(runtime_mode='distributed-integration', distributed_server=server)
    async with AsyncClient(transport=ASGITransport(app=app), base_url='http://test') as client:
        async with app.router.lifespan_context(app):
            yield client, app, server
        assert (await client.post('/auth/signin', json={})).status_code == 503
        assert (await client.get('/me/profile')).status_code == 503


async def signup(client, name):
    reply = await client.post('/auth/signup', json=dict(username=name, password='long-password', display_name=name))
    assert reply.status_code == 201, reply.text
    value = reply.json()
    return value, {'Authorization': 'Bearer ' + value['token']}


async def test_account_profile_session_and_actor_binding(database):
    async with application(database[0]) as (client, app, server):
        assert (await client.post('/auth/guest', json={})).status_code == 403
        assert (await client.get('/auth/me')).status_code == 401
        user, headers = await signup(client, 'native_account')
        assert (await client.get('/auth/me', headers=headers)).json()['user_id'] == user['user_id']
        assert (await client.post('/auth/signup', json=dict(username='native_account', password='long-password'))).status_code == 409
        assert (await client.post('/auth/signin', json=dict(username='native_account', password='bad-password'))).status_code == 401
        logged = await client.post('/auth/signin', json=dict(username='native_account', password='long-password'))
        assert logged.status_code == 200 and logged.json()['user_id'] == user['user_id']
        changed = await client.patch('/me/profile', headers=headers, json={'display_name': 'New Name'})
        assert changed.json() == {'display_name': 'New Name'}
        assert changed.headers['cache-control'] == 'no-store'
        assert (await client.patch('/me/profile', headers=headers,
            json={'display_name': 'Forged', 'user_id': 'another'})).status_code == 422
        assert (await client.get('/me/profile', headers=headers)).json() == {'display_name': 'New Name'}
        assert (await client.patch('/me/profile/appearance', headers=headers,
            json={'theme': 'himalayan', 'mode': 'dark'})).status_code == 200
        assert (await client.get('/me/profile/appearance', headers=headers)).json() == {'theme': 'himalayan', 'mode': 'dark'}
        assert (await client.post('/auth/signout', headers=headers)).status_code == 204
        assert (await client.get('/auth/me', headers=headers)).status_code == 401
        assert (await client.get('/distributed/rooms', headers=headers)).status_code == 401
        assert not hasattr(app.state, 'test_games') and not hasattr(app.state, 'rooms')


async def test_explicit_guest_login_and_method_boundary(database):
    async with application(database[0], guest_login_enabled=True) as (client, app, server):
        reply = await client.post('/auth/guest', json={'display_name': 'Guest One'})
        assert reply.status_code == 201, reply.text
        headers = {'Authorization': 'Bearer ' + reply.json()['token']}
        assert (await client.get('/auth/me', headers=headers)).status_code == 200
        for method, path in [('DELETE', '/me/profile'), ('POST', '/me/profile'), ('GET', '/auth/signin'),
                             ('POST', '/auth/admin'), ('POST', '/auth/social/google'),
                             ('POST', '/friends/requests/other'), ('DELETE', '/friends/other'),
                             ('POST', '/notifications/read'), ('POST', '/friends/other/messages'),
                             ('POST', '/rooms/room/ledger/settlements')]:
            assert (await client.request(method, path, headers=headers, json={})).status_code == 409, path
        preflight = await client.options('/me/profile', headers={'Origin': 'https://game.test',
            'Access-Control-Request-Method': 'PATCH', 'Access-Control-Request-Headers': 'Authorization, Content-Type'})
        assert preflight.status_code == 200


async def test_platform_player_reads_are_fresh_across_gateways(database):
    pool = database[0]
    async with application(pool) as (client, app, server):
        viewer, headers = await signup(client, 'viewer_account')
        other, _ = await signup(client, 'other_account')
        path = '/players/' + other['user_id']
        assert (await client.get(path, headers=headers)).json()['display_name'] == 'other_account'
        await PostgresPlayerProfileService(pool).update(other['user_id'], 'Remote Update')
        assert (await client.get(path, headers=headers)).json()['display_name'] == 'Remote Update'
        for endpoint, query in [('search', 'Remote'), ('directory', 'Remote Update')]:
            response = await client.get('/players/' + endpoint, params={'q': query}, headers=headers)
            assert response.status_code == 200, response.text
            assert response.json()[0]['user_id'] == other['user_id']
        assert (await client.get('/players/user-invalid', headers=headers)).status_code == 404
        assert (await client.get('/friends', headers=headers)).json() == {'friends': [], 'incoming': [], 'outgoing': []}
        assert (await pool.execute('SELECT count(*) FROM friend_notifications')).rows == [(0,)]
        assert (await pool.execute('SELECT count(*) FROM direct_messages')).rows == [(0,)]


async def test_native_catalog_members_invitations_ledger_authorization_and_bounds(database):
    async with application(database[0]) as (client, app, server):
        owner, headers = await signup(client, 'room_owner')
        other, outsider = await signup(client, 'room_outsider')
        made = await client.post('/distributed/rooms', headers=headers,
            json=dict(command_id='platform-room', name='Private', visibility='private', invitees=[]))
        assert made.status_code == 200, made.text
        room = made.json()['room_id']
        catalog = await client.get('/distributed/rooms', headers=headers, params={'limit': 1})
        assert catalog.status_code == 200 and catalog.headers['cache-control'] == 'no-store'
        assert catalog.json()['items'][0]['room_id'] == room
        assert (await client.get('/distributed/rooms', headers=outsider)).json()['items'] == []
        members = await client.get(f'/distributed/rooms/{room}/members', headers=headers)
        assert members.json()['items'] == [owner['user_id']]
        for suffix in ('members', 'ledger'):
            assert (await client.get(f'/distributed/rooms/{room}/{suffix}', headers=outsider)).status_code == 403
        ledger = await client.get(f'/distributed/rooms/{room}/ledger', headers=headers)
        assert ledger.status_code == 200 and ledger.json()['tables'] == [], ledger.text
        for path in ('/distributed/room-invitations', '/distributed/table-invitations'):
            assert (await client.get(path, headers=headers)).json()['items'] == []
            assert (await client.get(path, headers=headers, params={'limit': 101})).status_code == 422
        assert (await client.get('/distributed/rooms', headers=headers, params={'limit': 101})).status_code == 422
        assert (await client.get(f'/distributed/rooms/{room}/members', headers=headers,
            params={'after_user_id': 'not-an-id'})).status_code == 422


async def test_personal_phrases_are_shared_and_actor_scoped(database):
    async with application(database[0]) as (first, _, _), application(database[0]) as (second, _, _):
        a,ha=await signup(first,'phrasealice')
        b,hb=await signup(second,'phrasebob')
        response=await first.post('/me/phrases',headers=ha,json={'text':'Well played'})
        assert response.status_code==201,response.text
        phrase=response.json()['id']
        assert (await second.get('/me/phrases',headers=ha)).json()[0]['id']==phrase
        assert (await second.patch('/me/phrases/'+phrase,headers=hb,json={'text':'Changed'})).status_code==404
        assert (await second.patch('/me/phrases/'+phrase,headers=ha,json={'text':'Good game'})).status_code==200
        assert (await first.delete('/me/phrases/'+phrase,headers=ha)).status_code==200
        assert (await second.get('/me/phrases',headers=ha)).json()==[]
        assert (await first.post('/test-games/room/poke',headers=ha,json={})).status_code==409
