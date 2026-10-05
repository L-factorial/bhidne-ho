"""Exact committed deltas through isolated Redis to two independent gateways."""
from uuid import UUID
from copy import deepcopy

from app.durable_games.checkpoint_store import PostgresCheckpointStore
from app.durable_games.checkpoints import capture_checkpoint
from app.durable_games.delivery import GatewayDelivery, OutboxPublisher
from app.durable_games.delivery_store import PostgresDeliveryStore
from app.durable_games.inbox import PostgresInboxStore, LaneTarget
from app.durable_games.view_delta import apply_delta
from app.durable_games.view_generation import ViewGenerationWorker, projected_view
from test_checkpoint_store import database, host_game, advance
from test_view_generation import Presence
from test_redis_live_transport import redis_server, bus
from test_redis_signals import eventually


async def test_two_gateways_receive_exact_private_content_and_recover_missed_signal(redis_server,database):
    pool,_,fence,users=database
    checkpoints=PostgresCheckpointStore(pool,retain_view_transitions=True)
    host,game=await host_game(users)
    before=capture_checkpoint(game,table_revision=0)
    await checkpoints.save(before,expected_revision=None,fence=fence)
    lane=await PostgresInboxStore(pool).ensure_lane(LaneTarget(kind='table',room_id='room',table_id=UUID(game.table.table_id)))
    store=PostgresDeliveryStore(pool)
    original=store.page
    gateways=[GatewayDelivery(store,f'gateway-{n}') for n in range(2)]
    listeners=[bus(redis_server,g.instance_id,delivery_receiver=g) for g in gateways]
    sender=bus(redis_server,'view-publisher')
    frames=[[],[]];handles=[]
    try:
        for n,g in enumerate(gateways):
            async def send(page,n=n):frames[n].append(page)
            handles.append(await g.subscribe(users[n],f'phone-{n}',lane,send,deltas=True))
            await g.pump(handles[-1])
        for transport in [*listeners,sender]:await transport.start()
        await eventually(lambda:all(t.healthy for t in [*listeners,sender]))
        receipt=await advance(host,game)
        after=capture_checkpoint(game,table_revision=1)
        await checkpoints.save(after,expected_revision=0,fence=fence,receipt=receipt)
        worker=ViewGenerationWorker(pool,Presence(users[:2]))
        await worker.sweep_once()
        claims=sorted(await store.claim(),key=lambda c:c.sequence)
        assert len(claims)==2
        # The contiguous push path uses committed-row authorization, no page scan
        # and no HTTP snapshot construction. Both gateways see private audiences.
        async def no_scan(*args,**kwargs):raise AssertionError('unexpected catch-up scan')
        store.page=no_scan
        from app.durable_games.redis_presence import PresenceObservation, ConnectionPresence
        from app.durable_games.view_generation import view_scope
        class ActiveViews:
            async def observe(self,kind,key):
                assert (kind,key)==('room',view_scope(game.table.table_id))
                return PresenceObservation('observed',tuple(ConnectionPresence(g.instance_id,str(n),users[n],key)
                    for n,g in enumerate(gateways)))
        async def publish(destination,notice):
            content=deepcopy(notice.content)
            content['payload']['delta']['checksum']='0'*64
            from dataclasses import replace
            return await sender.send_delivery(destination,replace(notice,content=content))
        publisher=OutboxPublisher(store,ActiveViews(),publish)
        for claim in claims:
            # Even a signed internal hint cannot override its committed row.
            await publisher._publish(claim)
            await eventually(lambda:all(len(rows)==claim.sequence for rows in frames))
        await eventually(lambda:all(len(rows)==2 for rows in frames))
        names={u:u for u in users[:2]}
        for n,rows in enumerate(frames):
            events=[event for page in rows for event in page['events']]
            assert len(events)==1 and events[0]['payload']['viewer_seat']==n+1
            assert apply_delta(projected_view(before,users[n],names),events[0]['payload']['delta'],
                game_id=game.match_id,revision=0)==projected_view(after,users[n],names)
            await gateways[n].acknowledge(handles[n],2)
        store.page=original
        game.name='Changed during a missed Redis signal'
        await checkpoints.save(capture_checkpoint(game,table_revision=2),expected_revision=1,fence=fence)
        await worker.sweep_once()  # Deliberately do not publish these results.
        for n,g in enumerate(gateways):
            await g.pump(handles[n])
            assert frames[n][-1]['scanned_sequence']==4
            delta=frames[n][-1]['events'][0]['payload']['delta']
            assert delta['base_revision']==1 and delta['revision']==2
        # A departed seat cannot replay a formerly private delta.
        await pool.execute('DELETE FROM table_positions WHERE table_id=%s AND user_id=%s',
            (UUID(game.table.table_id),UUID(users[0][5:])))
        assert (await store.page(users[0],lane)).events==()
    finally:
        store.page=original
        for g in gateways:await g.stop()
        for transport in [sender,*listeners]:await transport.stop()
        await host.close()
