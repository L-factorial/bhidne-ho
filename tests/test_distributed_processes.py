"""Real independent gateway/owner failover; requires disposable service binaries."""
import asyncio
import json
import signal
from uuid import uuid4

import httpx
import pytest

from app.database import Database
from distributed_process_support import cluster, until


async def signup(client, base, name):
    response=await client.post(base+'/auth/signup',json=dict(username=name,password='integration-test-password'))
    assert response.status_code==201,response.text
    value=response.json()
    return value,{'Authorization':'Bearer '+value['token']}


async def submit(client, base, headers, target, command, payload=None, *, match=None, revision=None, key=None, wait=True):
    body=dict(command_id=key or uuid4().hex,command=command,payload=payload or {})
    if match is not None:body['match_id']=match
    if revision is not None:body['expected_revision']=revision
    envelope=dict(target=target,body=body)
    reply=await client.post(base+'/distributed/commands',headers=headers,json=envelope)
    assert reply.status_code==200,reply.text
    value=reply.json()
    if wait:value=await terminal(client,base,headers,value)
    return value,envelope


async def terminal(client, base, headers, value):
    async def check():
        response=await client.get(base+'/distributed/commands/'+value['lane_id']+'/'+value['command_id'],headers=headers)
        assert response.status_code==200,response.text
        result=response.json()
        return result if result['status']!='pending' else None
    return await until(check)


async def room(client,cluster,headers):
    response=await client.post(cluster.urls[0]+'/distributed/rooms',headers=headers,
        json=dict(command_id=uuid4().hex,name='Process test',visibility='public',invitees=[]))
    assert response.status_code==200,response.text
    return response.json()['room_id']


async def test_independent_gateways_redis_loss_pause_takeover_and_receipt_dedupe(cluster):
    async with httpx.AsyncClient(timeout=12) as client:
        alice,ha=await signup(client,cluster.urls[0],'alice')
        bob,hb=await signup(client,cluster.urls[1],'bob')
        room_id=await room(client,cluster,ha)
        target=dict(kind='room',room_id=room_id)
        entered,_=await submit(client,cluster.urls[1],hb,target,'enter-room')
        assert entered['status']=='accepted'
        created,envelope=await submit(client,cluster.urls[1],ha,target,'create-table',dict(game_type='marriage',capacity=2))
        assert created['status']=='accepted'
        table=created['outcome']['table_id'];match=created['outcome']['match_id']
        table_target=dict(kind='table',room_id=room_id,table_id=table)
        async def snapshot(headers=ha, gateway=1):
            response=await client.get(cluster.urls[gateway]+f'/distributed/rooms/{room_id}',params={'table_id':table},headers=headers)
            assert response.status_code==200,response.text
            return response.json()['snapshot']
        for command,headers in [('join-seat',hb),('lock',ha),('start',ha)]:
            view=await snapshot()
            result,_=await submit(client,cluster.urls[1],headers,table_target,command,match=match,revision=view['table_revision'])
            assert result['status']=='accepted',result
        # Distinct authenticated projections on different processes, same committed engine.
        av,bv=await asyncio.gather(snapshot(ha,0),snapshot(hb,1))
        assert av['durable_game_id']==bv['durable_game_id']
        assert av['marriage']['private']['hand']!=bv['marriage']['private']['hand']
        game_target=dict(kind='game',room_id=room_id,table_id=table,game_id=av['durable_game_id'])
        # Same original command submitted on both gateways becomes one inbox entry.
        turn=av['game']['turn']['player_id']
        actor=next(p['user_id'] for p in av['players'] if p['player_id']==turn)
        headers=ha if actor==alice['user_id'] else hb
        action=dict(target=game_target,body=dict(command_id=uuid4().hex,command='DECLARE_TUNNELAS',payload={'melds':[]},match_id=match,expected_revision=av['game']['revision']))
        replies=await asyncio.gather(*(client.post(url+'/distributed/commands',headers=headers,json=action) for url in cluster.urls))
        assert all(r.status_code==200 for r in replies),[r.text for r in replies]
        assert replies[0].json()['sequence']==replies[1].json()['sequence']
        accepted=await terminal(client,cluster.urls[1],headers,replies[0].json())
        assert accepted['status']=='accepted',json.dumps(dict(outcome=accepted['outcome'],game=av['game'],actor=actor,players=av['players']))
        stale,_=await submit(client,cluster.urls[0],headers,game_target,'DECLARE_TUNNELAS',{'melds':[]},match=match,revision=av['game']['revision'])
        assert stale['status']=='rejected' and stale['sequence']==accepted['sequence']+1
        before=await snapshot()
        owner,epoch,_=await cluster.owner(room_id);other=1-owner
        # Actual stop of Redis: durable chat progresses through DB fallback.
        await cluster.redis.stop()
        chat_target=dict(kind='table_chat',room_id=room_id,table_id=table)
        message,msg=await submit(client,cluster.urls[other],ha,chat_target,'send-chat',{'text':'Redis is offline'})
        assert message['status']=='accepted'
        history=await client.get(cluster.urls[other]+'/distributed/history/chat/'+message['lane_id'],headers=hb)
        assert history.status_code==200 and history.json()['items'][0]['text']=='Redis is offline'
        # Pause owner beyond its real lease. Survivor must reacquire with a new epoch.
        cluster.processes[owner].send_signal(signal.SIGSTOP)
        pending,intent=await submit(client,cluster.urls[other],hb,chat_target,'send-chat',{'text':'After takeover'},wait=False)
        recovered=await terminal(client,cluster.urls[other],hb,pending)
        assert recovered['status']=='accepted'
        replacement=await cluster.owner(room_id)
        assert replacement[0]==other and replacement[1]>epoch,replacement
        cluster.processes[owner].send_signal(signal.SIGCONT)
        await cluster.redis.start()
        replay=await client.post(cluster.urls[owner]+'/distributed/commands',headers=headers,json=action)
        assert replay.status_code==200 and replay.json()==accepted
        # Old owner cannot restore its old epoch after resuming; game remains committed.
        await asyncio.sleep(1)
        assert (await cluster.owner(room_id))[:2]==replacement[:2]
        assert (await snapshot(ha,owner))['game']['revision']==before['game']['revision']
        counts=await cluster.rows('SELECT count(*) FROM command_inbox WHERE command_id=%s',(action['body']['command_id'],))
        assert counts==[(1,)]
        # Continue engine execution on the replacement after the old process resumes.
        second_headers=hb if actor==alice['user_id'] else ha
        declared,_=await submit(client,cluster.urls[other],second_headers,game_target,'DECLARE_TUNNELAS',{'melds':[]},match=match,revision=before['game']['revision'])
        assert declared['status']=='accepted'
        before=await snapshot(ha,other)
        # Kill replacement; survivor reconstructs and drains a gameplay command.
        cluster.processes[other].kill();await cluster.processes[other].wait()
        final,_=await submit(client,cluster.urls[owner],headers,game_target,'DRAW_CARD',{'source':'stock'},match=match,revision=before['game']['revision'])
        assert final['status']=='accepted'
        assert (await cluster.owner(room_id))[1]>replacement[1]
        assert (await snapshot(ha,owner))['game']['revision']>before['game']['revision']
        assert (await client.post(cluster.urls[owner]+'/rooms',headers=ha,json={})).status_code==409


async def test_real_atomic_table_limit_and_legacy_dataset_exclusion(cluster):
    legacy=Database(cluster.dburl)
    try:
        with pytest.raises(RuntimeError,match='reserved'):await legacy.open()
    finally:await legacy.close()
    async with httpx.AsyncClient(timeout=12) as client:
        accounts=[await signup(client,cluster.urls[i%2],f'player{i}') for i in range(6)]
        room_id=await room(client,cluster,accounts[0][1]);target=dict(kind='room',room_id=room_id)
        for _,headers in accounts[1:]:
            assert (await submit(client,cluster.urls[1],headers,target,'enter-room'))[0]['status']=='accepted'
        results=await asyncio.gather(*(submit(client,cluster.urls[i%2],headers,target,'create-table',dict(game_type='marriage',capacity=2,name=f'Table {i}')) for i,(_,headers) in enumerate(accounts)))
        assert sorted(result[0]['status'] for result in results)==['accepted']*5+['rejected']
        assert await cluster.rows('SELECT open_table_count FROM rooms WHERE id=%s',(room_id,))==[(5,)]
        assert await cluster.rows('SELECT count(*) FROM room_tables WHERE room_id=%s',(room_id,))==[(5,)]


async def test_actual_nginx_http_websocket_and_retry_contract(cluster):
    import os
    from pathlib import Path
    from distributed_process_support import port
    from websockets.asyncio.client import connect
    binary=os.environ.get('NGINX_TEST_BIN')
    if not binary:pytest.skip('Set NGINX_TEST_BIN for actual proxy configuration verification.')
    number=port();base=f'http://127.0.0.1:{number}'
    source=Path('deploy/distributed-nginx.conf').read_text()
    source=source.replace('gateway_a:8080',cluster.urls[0].removeprefix('http://')).replace('gateway_b:8080',cluster.urls[1].removeprefix('http://'))
    source=source.replace('listen 8080;',f'listen 127.0.0.1:{number};\n    add_header X-Integration-Upstream $upstream_addr always;')
    config=cluster.directory/'nginx.conf'
    config.write_text(f'daemon off;\npid {cluster.directory}/nginx.pid;\nerror_log {cluster.directory}/nginx-error.log;\nevents {{ worker_connections 128; }}\nhttp {{ access_log off; client_body_temp_path {cluster.directory}/body; proxy_temp_path {cluster.directory}/proxy;\n'+source+'\n}\n')
    process=await asyncio.create_subprocess_exec(binary,'-t','-c',str(config),stdout=asyncio.subprocess.PIPE,stderr=asyncio.subprocess.STDOUT)
    output,_=await process.communicate();assert process.returncode==0,output.decode()
    process=await asyncio.create_subprocess_exec(binary,'-c',str(config),stdout=asyncio.subprocess.DEVNULL,stderr=asyncio.subprocess.DEVNULL)
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            async def ready():
                try:return (await client.get(base+'/health')).status_code==200
                except httpx.HTTPError:return False
            await until(ready,10)
            upstreams={(await client.get(base+'/health')).headers['x-integration-upstream'] for _ in range(6)}
            assert len(upstreams)==2
            account,headers=await signup(client,base,'proxyplayer')
            body=dict(command_id=uuid4().hex,name='Proxy room',visibility='private',invitees=[])
            first=await client.post(base+'/distributed/rooms',headers=headers,json=body)
            second=await client.post(base+'/distributed/rooms',headers=headers,json=body)
            assert first.status_code==second.status_code==200 and first.json()==second.json()
            assert first.headers['x-integration-upstream']!=second.headers['x-integration-upstream']
            room_id=first.json()['room_id']
            lane=(await client.post(base+'/distributed/streams/open',headers=headers,json=dict(kind='room_chat',room_id=room_id))).json()['lane_id']
            async with connect(base.replace('http:','ws:')+'/distributed/delivery',origin='http://localhost') as ws:
                await ws.send(json.dumps(dict(type='AUTH',token=account['token'],client_id='proxy-device')))
                assert json.loads(await ws.recv())['type']=='READY'
                await ws.send(json.dumps(dict(type='SUBSCRIBE',subscription_id='one',lane_id=lane)))
                assert json.loads(await ws.recv())['type']=='SUBSCRIBED'
                await cluster.redis.stop()
                outcome,_=await submit(client,base,headers,dict(kind='room_chat',room_id=room_id),'send-chat',{'text':'Across the proxy without Redis'})
                assert outcome['status']=='accepted'
                async with asyncio.timeout(15):
                    while True:
                        frame=json.loads(await ws.recv())
                        if frame['type']=='DELIVERY_PAGE' and frame.get('events'):
                            assert 'Across the proxy without Redis' in json.dumps(frame)
                            break
                await ws.send(json.dumps(dict(type='ACK',subscription_id='one',scanned_sequence=frame['scanned_sequence'])))
                async with asyncio.timeout(5):
                    while json.loads(await ws.recv())['type']!='ACKED':pass
    finally:
        if process.returncode is None:
            process.terminate()
            try:await asyncio.wait_for(process.wait(),5)
            except TimeoutError:process.kill();await process.wait()


async def test_database_outage_never_acknowledges_unpersisted_work_and_same_id_recovers(cluster):
    async with httpx.AsyncClient(timeout=12) as client:
        user,headers=await signup(client,cluster.urls[0],'databaseplayer')
        room_id=await room(client,cluster,headers)
        target=dict(kind='room',room_id=room_id)
        original=dict(target=target,body=dict(command_id=uuid4().hex,command='create-table',payload={'game_type':'marriage','capacity':2,'name':'After database restart'}))
        cluster.db_process.send_signal(signal.SIGINT)
        await asyncio.wait_for(cluster.db_process.wait(),10)
        try:
            reply=await client.post(cluster.urls[0]+'/distributed/commands',headers=headers,json=original)
            assert reply.status_code>=500,reply.text
        except httpx.TimeoutException:
            pass  # Transport uncertainty is not a terminal command rejection.
        await cluster.restart_database()
        async def enqueue():
            response=await client.post(cluster.urls[1]+'/distributed/commands',headers=headers,json=original)
            return response.json() if response.status_code==200 else None
        queued=await until(enqueue,45)
        result=await terminal(client,cluster.urls[1],headers,queued)
        assert result['status']=='accepted'
        retry=await client.post(cluster.urls[0]+'/distributed/commands',headers=headers,json=original)
        assert retry.status_code==200 and retry.json()==result
        assert await cluster.rows('SELECT count(*) FROM room_tables WHERE room_id=%s',(room_id,))==[(1,)]
