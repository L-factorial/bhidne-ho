from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app.auth.service import AuthenticationError
from app.durable_games.transport import create_router


class Auth:
    async def authenticate(self, token):
        if token != 'valid':
            raise AuthenticationError()
        return SimpleNamespace(user_id='user-00000000-0000-0000-0000-000000000001')


class Ingress:
    def __init__(self): self.calls = []
    async def submit(self, actor, target, body):
        self.calls.append((actor,target.kind,body))
        return dict(status='pending',command_id=body['command_id'])
    async def status(self, actor, lane, command):
        self.calls.append((actor,str(lane),command))
        return dict(status='pending',command_id=command)


class Gateway:
    def __init__(self): self.handles = {}; self.acks = []; self.removed = []
    async def subscribe(self, actor, client, lane, send, *, on_close, paused):
        assert paused
        handle = uuid4(); self.handles[handle]=(actor,client,lane,send);return handle
    def subscription_cursor(self, handle): return 4
    def activate(self, handle): assert handle in self.handles
    async def acknowledge(self, handle, seq):
        if seq > 4: raise ValueError('Not offered')
        self.acks.append((handle,seq));return seq
    def unsubscribe(self, handle): self.handles.pop(handle,None);self.removed.append(handle)


@pytest.fixture
def fixture():
    app=FastAPI(); ingress=Ingress(); gateway=Gateway()
    app.include_router(create_router(auth=Auth(),hosted=ingress,chat=ingress,social=ingress,gateway=gateway,allowed_origins={'https://game.test'}))
    with TestClient(app) as client:
        yield client,ingress,gateway


def test_actor_from_bearer_and_payload_impersonation_rejected(fixture):
    c,i,_=fixture
    body=dict(target=dict(kind='room',room_id='room'),body=dict(command_id='same',command='leave-room',payload={}))
    assert c.post('/distributed/commands',json=body).status_code==401
    result=c.post('/distributed/commands',json=body,headers={'Authorization':'Bearer valid'})
    assert result.status_code==200 and result.headers['cache-control']=='no-store'
    assert i.calls[0][0].endswith('0001')
    body['actor']='someone-else'
    assert c.post('/distributed/commands',json=body,headers={'Authorization':'Bearer valid'}).status_code==422
    assert len(i.calls)==1


def test_status_uses_authenticated_actor(fixture):
    c,i,_=fixture;lane=uuid4()
    assert c.get(f'/distributed/commands/{lane}/same',headers={'Authorization':'Bearer valid'}).json()['status']=='pending'
    assert i.calls[0][1:]==(str(lane),'same')


def test_socket_handshake_ack_and_disconnect_cleanup(fixture):
    c,_,g=fixture
    with c.websocket_connect('/distributed/delivery',headers={'origin':'https://game.test'}) as ws:
        ws.send_json(dict(type='AUTH',token='valid',client_id='phone'));assert ws.receive_json()=={'type':'READY'}
        ws.send_json(dict(type='SUBSCRIBE',subscription_id='mine',lane_id=str(uuid4())))
        assert ws.receive_json()['cursor']==4
        ws.send_json(dict(type='ACK',subscription_id='mine',scanned_sequence=4));assert ws.receive_json()['type']=='ACKED'
        ws.send_json(dict(type='PING'));assert ws.receive_json()['type']=='PONG'
    assert not g.handles and len(g.acks)==1


@pytest.mark.parametrize('frame',[dict(type='ACK',subscription_id='foreign',scanned_sequence=4),dict(type='ACK',subscription_id='mine',scanned_sequence=5)])
def test_unknown_or_unoffered_ack_closes_socket(fixture,frame):
    c,_,g=fixture
    with c.websocket_connect('/distributed/delivery') as ws:
        ws.send_json(dict(type='AUTH',token='valid',client_id='phone'));ws.receive_json()
        ws.send_json(dict(type='SUBSCRIBE',subscription_id='mine',lane_id=str(uuid4())));ws.receive_json()
        ws.send_json(frame)
        with pytest.raises(WebSocketDisconnect): ws.receive_json()
    assert not g.acks and not g.handles


def test_bad_origin_and_auth_never_subscribe(fixture):
    c,_,g=fixture
    with pytest.raises(WebSocketDisconnect):
        with c.websocket_connect('/distributed/delivery',headers={'origin':'https://evil.test'}): pass
    with c.websocket_connect('/distributed/delivery') as ws:
        ws.send_json(dict(type='AUTH',token='invalid',client_id='phone'))
        with pytest.raises(WebSocketDisconnect): ws.receive_json()
    assert not g.handles


def test_read_routes_bind_actor_selection_cursor_and_bounds():
    calls=[]
    class Reads:
        def __init__(self): self.hosted=self.chat=self.social=self
        async def room(self,room,actor,**kw): calls.append((actor,room,kw));return {'snapshot':{'private':'own'}}
        async def recipient(self,actor): calls.append((actor,'recipient'));return {'lane_id':str(uuid4())}
        async def streams(self,actor,**kw): calls.append((actor,'streams',kw));return {'items':[],'next_lane_id':None}
        async def page(self,actor,lane,**kw): calls.append((actor,'history',kw));return {'items':[],'next_sequence':None}
        async def legacy_notifications(self,actor,**kw): calls.append((actor,'legacy',kw));return {'source':'legacy','items':[],'next_before':None}
    app=FastAPI();i=Ingress();app.include_router(create_router(auth=Auth(),hosted=i,chat=i,social=i,gateway=Gateway(),allowed_origins=set(),reads=Reads()))
    with TestClient(app) as c:
        headers={'Authorization':'Bearer valid'};table=uuid4()
        assert c.get('/distributed/rooms/r').status_code==401
        response=c.get(f'/distributed/rooms/r?table_id={table}',headers=headers)
        assert response.status_code==200 and response.headers['cache-control']=='no-store'
        assert str(calls[-1][2]['table_id'])==str(table)
        assert c.post('/distributed/streams/recipient',headers=headers).status_code==200
        assert c.get('/distributed/streams/social?limit=101',headers=headers).status_code==422
        assert c.get('/distributed/streams/social',headers=headers).status_code==200
        assert c.get(f'/distributed/history/chat/{uuid4()}?after=3',headers=headers).status_code==200
        assert calls[-1][2]['after']==3
        assert c.get('/distributed/legacy/notifications?before_at=bad',headers=headers).status_code==422
        assert c.get('/distributed/legacy/notifications',headers=headers).json()['source']=='legacy'
        assert all(row[0].endswith('0001') for row in calls)


def test_room_catalog_creation_binds_actor_and_preserves_original_request():
    calls=[]
    class Catalog:
        async def create(self,actor,body):
            calls.append((actor,body));return dict(command_id=body['command_id'],status='accepted',room_id='a'*32)
    app=FastAPI();i=Ingress();app.include_router(create_router(auth=Auth(),hosted=i,chat=i,social=i,gateway=Gateway(),allowed_origins=set(),catalog=Catalog()))
    with TestClient(app) as c:
        body=dict(command_id='same',name='Room',visibility='private',invitees=[])
        assert c.post('/distributed/rooms',json=body).status_code==401
        first=c.post('/distributed/rooms',json=body,headers={'Authorization':'Bearer valid'})
        second=c.post('/distributed/rooms',json=body,headers={'Authorization':'Bearer valid'})
        assert first.json()==second.json() and first.headers['cache-control']=='no-store'
        assert calls[0][0].endswith('0001') and calls[0][1]==body
        assert c.post('/distributed/rooms',json=dict(body,actor='foreign'),headers={'Authorization':'Bearer valid'}).status_code==422


@pytest.mark.parametrize('authorized', [True, False])
def test_socket_presence_uses_authenticated_actor_and_authorized_room(authorized):
    from app.durable_games.redis_presence import ConnectionPresence
    from app.durable_games.queries import QueryAccessDenied
    class Presence:
        def __init__(self): self.entries = {}; self.attached = []
        def attach(self, actor, *, room_id=None):
            entry = ConnectionPresence('boot', uuid4().hex, actor, room_id)
            self.entries[entry.connection_id] = entry
            self.attached.append(entry)
            return entry
        async def detach(self, entry): self.entries.pop(entry.connection_id, None)
    p, g, i = Presence(), Gateway(), Ingress()
    looked_up = []
    async def room(actor, lane):
        looked_up.append((actor, lane))
        if not authorized: raise QueryAccessDenied('no access')
        return 'authorized-room'
    app = FastAPI()
    app.include_router(create_router(auth=Auth(), hosted=i, chat=i, social=i, gateway=g,
        allowed_origins=set(), presence=p, presence_room=room))
    with TestClient(app) as c:
        with c.websocket_connect('/distributed/delivery') as ws:
            ws.send_json(dict(type='AUTH', token='invalid', client_id='phone'))
            with pytest.raises(WebSocketDisconnect): ws.receive_json()
        assert not p.attached
        with c.websocket_connect('/distributed/delivery') as ws:
            ws.send_json(dict(type='AUTH', token='valid', client_id='phone'))
            assert ws.receive_json()['type'] == 'READY'
            assert len(p.entries) == 1
            lane = str(uuid4())
            ws.send_json(dict(type='SUBSCRIBE', subscription_id='one', lane_id=lane))
            if not authorized:
                with pytest.raises(WebSocketDisconnect): ws.receive_json()
            else:
                assert ws.receive_json()['type'] == 'SUBSCRIBED'
                ws.send_json(dict(type='SUBSCRIBE', subscription_id='two', lane_id=str(uuid4())))
                assert ws.receive_json()['type'] == 'SUBSCRIBED'
                assert len(p.entries) == 2  # One user and one shared room registration.
                ws.send_json(dict(type='UNSUBSCRIBE', subscription_id='one'))
                ws.send_json(dict(type='PING')); ws.receive_json()
                assert len(p.entries) == 2
                ws.send_json(dict(type='UNSUBSCRIBE', subscription_id='two'))
                ws.send_json(dict(type='PING')); ws.receive_json()
                assert len(p.entries) == 1
        assert not p.entries and not g.handles
        assert all(e.user_id.endswith('0001') for e in p.attached)
        assert len(p.attached) == (2 if authorized else 1)
