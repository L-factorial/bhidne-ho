"""End-to-end game command execution on production SQL in PostgreSQL/WASM."""
from contextlib import asynccontextmanager
from dataclasses import replace
from uuid import UUID, uuid4

import pytest
from psycopg import OperationalError

from app.durable_games.executor import GameLaneExecutor
from app.durable_games.inbox import LaneTarget, PostgresInboxStore
from app.durable_games.checkpoints import capture_checkpoint
from app.durable_games.store import DurableGameConflict, StaleGameOwner
from app.models.action import ReliableActionCommand
from test_checkpoint_store import database, host_game, advance
from test_hosted_checkpoints import engine_state


async def setup_game(database, kind='marriage', *, receipt_limit=10000):
    pool, checkpoints, fence, users = database
    host, game = await host_game(users, kind)
    await checkpoints.save(capture_checkpoint(game, table_revision=0), expected_revision=None,
                           fence=fence, receipt_limit=receipt_limit)
    inbox = PostgresInboxStore(pool)
    lane = await inbox.ensure_lane(LaneTarget(kind='game', room_id='room', table_id=UUID(game.table.table_id),
                                             game_id=game.durable_game_id))
    return host, game, inbox, lane, GameLaneExecutor(inbox)


async def test_flush_every_player_can_reveal_in_serialized_durable_lane(database):
    import asyncio
    pool,checkpoints,fence,users=database
    host,game=await host_game(users,'flush')
    try:
        await advance(host,game,'DEAL_CARDS'); await advance(host,game,'SKIP_CUT')
        state=engine_state(game)
        from app.multiplayer.table_session import sync
        import time
        sync(game,time.time())
        original=capture_checkpoint(game,table_revision=0)
        await checkpoints.save(original,expected_revision=None,fence=fence)
        inbox=PostgresInboxStore(pool)
        lane=await inbox.ensure_lane(LaneTarget(kind='game',room_id='room',table_id=UUID(game.table.table_id),game_id=game.durable_game_id))
        requests=[ReliableActionCommand(match_id=game.match_id,command_id=uuid4().hex,
            expected_revision=state.revision,command='SEE_CARDS',payload={'round_number':state.round_number}).model_dump(mode='json') for _ in game.users]
        await asyncio.gather(*(inbox.enqueue(lane,user,request) for user,request in zip(game.users,requests)))
        executor=GameLaneExecutor(inbox)
        outcomes=[await executor.execute_one(lane,fence) for _ in requests]
        active = next(u for u in game.users if str(game.flush_seats[u]) == state.current_player_id)
        assert all(r.outcome['status'] == 'accepted' for r in outcomes)
        loaded=await checkpoints.load(game.table.table_id)
        assert loaded.checkpoint['data']['engine']['revision']==state.revision+len(game.users)
        assert loaded.checkpoint['data']['host']['session']['turns']==original['data']['host']['session']['turns']
        for user,request in zip(game.users,requests):
            assert (await inbox.enqueue(lane,user,request)).outcome['status']=='accepted'
        assert await executor.execute_one(lane,fence) is None
    finally:
        await host.close()


def command(game, kind=None, *, expected=None, command_id=None, payload=None):
    state = engine_state(game)
    name = kind or {'marriage': 'DRAW_CARD', 'flush': 'DEAL_CARDS', 'callbreak': 'SHUFFLE_DECK'}[game.game_type]
    if kind is None and game.game_type == 'callbreak' and state.phase.value == 'SELECTING_DEALER':
        name = 'PICK_DEALER_CARD'
        if payload is None:
            payload = {'position': state.current_player - 1}
    actor = (game.users[state.current_player - 1] if game.game_type == 'callbreak'
             else next(u for u in game.users if str(game.flush_seats[u]) == state.config.player_ids[state.current_seat])
             if game.game_type == 'flush' else game.users[state.current_seat])
    request = ReliableActionCommand(match_id=game.match_id, command_id=command_id or uuid4().hex,
        expected_revision=state.revision if expected is None else expected, command=name,
        payload=payload if payload is not None else {'source': 'stock'} if name == 'DRAW_CARD' else {})
    return actor, request.model_dump(mode='json')


@pytest.mark.parametrize('kind', ['callbreak', 'marriage', 'flush'])
async def test_executes_ordered_commands_and_persists_authorized_events(database, kind):
    pool, checkpoints, fence, users = database
    host, game, inbox, lane, executor = await setup_game(database, kind)
    try:
        original = capture_checkpoint(game, table_revision=0)
        actor, request = command(game)
        first = await inbox.enqueue(lane, actor, request)
        _, stale = command(game)  # Same expected revision: runs AFTER the first.
        await inbox.enqueue(lane, actor, stale)
        result = await executor.execute_one(lane, fence)
        assert result.sequence == first.sequence and result.outcome['status'] == 'accepted'
        loaded = await checkpoints.load(game.table.table_id)
        assert loaded.checkpoint['data']['engine']['revision'] > original['data']['engine']['revision']
        assert capture_checkpoint(game, table_revision=0) == original  # No live host was touched.
        assert len(host.tables['room']) == 1 and host._offer_tasks == {}
        second = await executor.execute_one(lane, fence)
        assert second.sequence == 2 and second.outcome['status'] == 'rejected'
        assert second.outcome['revision'] == result.outcome['revision']
        assert await executor.execute_one(lane, fence) is None
        assert (await inbox.enqueue(lane, actor, request)).outcome == result.outcome
        rows = (await pool.execute('SELECT sequence,event_type,audience_user_id,payload FROM notification_outbox ORDER BY sequence')).rows
        assert [r[0] for r in rows] == list(range(1, len(rows) + 1))
        acknowledgments = [r for r in rows if r[1] == 'ACTION_ACK']
        assert len(acknowledgments) == 2
        assert all(r[2] == UUID(actor[5:]) for r in acknowledgments)
        assert any(r[1] == 'GAME_STATE_CHANGED' and r[2] is None for r in rows)
        assert (await checkpoints.load(game.table.table_id)).receipt_snapshot['receipt_count'] == 2
        if kind == 'marriage':
            private = [r for r in rows if r[2] is not None and r[1] != 'ACTION_ACK']
            assert private
            for row in private:
                seat = int(row[3]['payload']['player_id'])
                assert row[2] == UUID(game.users[seat - 1][5:])
            assert all(r[2] is not None for r in rows if r[1] == 'PLAYER_STATE')
    finally:
        await host.close()


@pytest.mark.parametrize('case', ['spectator', 'membership', 'invalid', 'revision', 'system'])
async def test_execution_reauthorizes_and_rejects_without_engine_effects(database, case):
    pool, checkpoints, fence, users = database
    host, game, inbox, lane, executor = await setup_game(database)
    try:
        before = await checkpoints.load(game.table.table_id)
        actor, request = command(game)
        if case in ('spectator', 'membership'): actor = users[-1]
        if case == 'system': actor = 'system:timer'
        if case == 'revision': request['expected_revision'] = 0
        if case == 'invalid': request['payload'] = {'source': 'invalid'}
        await inbox.enqueue(lane, actor, request)
        if case == 'membership':
            await pool.execute('DELETE FROM room_memberships WHERE user_id=%s', (UUID(actor[5:]),))
        result = await executor.execute_one(lane, fence)
        assert result.outcome['status'] == 'rejected'
        assert (await checkpoints.load(game.table.table_id)).checkpoint == before.checkpoint
        assert (await pool.execute('SELECT count(*) FROM game_events')).rows == [(0,)]
        assert (await pool.execute("SELECT count(*) FROM notification_outbox WHERE event_type<>'ACTION_ACK'")).rows == [(0,)]
        assert (await inbox.lookup(lane, actor, request['command_id'])).outcome == result.outcome
    finally:
        await host.close()


async def test_rollback_and_unknown_commit_reload_instead_of_replaying(database, monkeypatch):
    pool, checkpoints, fence, users = database
    host, game, inbox, lane, executor = await setup_game(database, 'callbreak')
    try:
        actor, request = command(game)
        await inbox.enqueue(lane, actor, request)
        initial = await checkpoints.load(game.table.table_id)
        outbox = executor._outbox
        async def fail_after_writes(claim, events):
            await outbox(claim, events)
            raise OperationalError('connection lost before commit')
        monkeypatch.setattr(executor, '_outbox', fail_after_writes)
        with pytest.raises(OperationalError): await executor.execute_one(lane, fence)
        assert (await checkpoints.load(game.table.table_id)).checkpoint == initial.checkpoint
        assert (await pool.execute('SELECT count(*) FROM notification_outbox')).rows == [(0,)]
        assert (await inbox.lookup(lane, actor, request['command_id'])).status == 'pending'
        monkeypatch.setattr(executor, '_outbox', outbox)
        transaction = pool.transaction
        @asynccontextmanager
        async def lost_commit_response():
            async with transaction(): yield pool
            raise OperationalError('commit succeeded but response lost')
        with monkeypatch.context() as patch:
            patch.setattr(pool, 'transaction', lost_commit_response)
            with pytest.raises(OperationalError): await executor.execute_one(lane, fence)
        committed = await checkpoints.load(game.table.table_id)
        event_count = (await pool.execute('SELECT count(*) FROM notification_outbox')).rows
        assert await executor.execute_one(lane, fence) is None
        assert (await checkpoints.load(game.table.table_id)).checkpoint == committed.checkpoint
        assert (await pool.execute('SELECT count(*) FROM notification_outbox')).rows == event_count
        assert (await pool.execute('SELECT count(*) FROM game_events')).rows == [(1,)]
    finally:
        await host.close()


async def test_terminal_command_queues_finalization_and_following_request_rejects(database):
    pool, checkpoints, fence, users = database
    host, game, inbox, lane, executor = await setup_game(database)
    try:
        actor, fold = command(game, 'FOLD')
        await inbox.enqueue(lane, actor, fold)
        _, later = command(game)
        await inbox.enqueue(lane, actor, later)
        assert (await executor.execute_one(lane, fence)).outcome['status'] == 'accepted'
        assert (await executor.execute_one(lane, fence)).outcome['status'] == 'rejected'
        loaded = await checkpoints.load(game.table.table_id)
        assert loaded.checkpoint['data']['phase'] == 'COMPLETED'
        assert loaded.receipt_snapshot['receipt_count'] == 2
        assert (await pool.execute('SELECT count(*) FROM game_finalization_jobs')).rows == [(1,)]
        assert (await pool.execute('SELECT count(*) FROM active_game_players')).rows == [(0,)]
    finally:
        await host.close()


async def test_superseded_match_rejection_does_not_change_new_match(database):
    pool, checkpoints, fence, users = database
    host, game, inbox, lane, executor = await setup_game(database)
    new_host, new_game = await host_game(users)
    try:
        actor, queued = command(game)
        await inbox.enqueue(lane, actor, queued)
        receipt = await advance(host, game, command='FOLD')
        await checkpoints.save(capture_checkpoint(game, table_revision=1), expected_revision=0, fence=fence, receipt=receipt)
        new_game.table.table_id = game.table.table_id
        new_game.previous_match_id = game.match_id
        new_checkpoint = capture_checkpoint(new_game, table_revision=2)
        await checkpoints.save(new_checkpoint, expected_revision=1, fence=fence)
        rejected = await executor.execute_one(lane, fence)
        assert rejected.outcome['status'] == 'rejected'
        assert (await checkpoints.load(game.table.table_id)).checkpoint == new_checkpoint
        assert (await checkpoints.load(game.table.table_id)).receipt_snapshot['receipt_count'] == 0
    finally:
        await host.close()
        await new_host.close()


async def test_admission_reserves_receipt_capacity_and_fence_is_rechecked(database):
    pool, checkpoints, fence, users = database
    host, game, inbox, lane, executor = await setup_game(database, receipt_limit=1)
    try:
        actor, first = command(game)
        await inbox.enqueue(lane, actor, first)
        _, second = command(game)
        with pytest.raises(DurableGameConflict, match='receipt admission'):
            await inbox.enqueue(lane, actor, second)
        with pytest.raises(StaleGameOwner): await executor.execute_one(lane, replace(fence, epoch=2))
        assert (await inbox.lookup(lane, actor, first['command_id'])).status == 'pending'
        await executor.execute_one(lane, fence)
        assert (await inbox.enqueue(lane, actor, first)).duplicate
    finally:
        await host.close()


async def test_scheduler_drains_independent_database_lanes_and_paged_discovery(database):
    import asyncio
    from app.durable_games.scheduler import GameLaneScheduler
    pool, checkpoints, fence, users = database
    host, game, inbox, lane, executor = await setup_game(database)
    second_host, second = await host_game(users[2:])
    scheduler = GameLaneScheduler(executor, workers=2)
    try:
        await checkpoints.save(capture_checkpoint(second, table_revision=0), expected_revision=None, fence=fence)
        other_lane = await inbox.ensure_lane(LaneTarget(kind='game', room_id='room',
            table_id=UUID(second.table.table_id), game_id=second.durable_game_id))
        for target_game, target_lane in ((game, lane), (game, lane), (second, other_lane)):
            actor, request = command(target_game)
            await inbox.enqueue(target_lane, actor, request)
        first_page = await inbox.pending_lanes(room_id='room', kind='game', limit=1)
        next_page = await inbox.pending_lanes(room_id='room', kind='game', limit=1, after_lane_id=first_page[0])
        assert set(first_page + next_page) == {lane, other_lane}
        scheduler.start()
        for lane_id in first_page + next_page: assert scheduler.offer(lane_id, fence)
        await asyncio.wait_for(scheduler.wait_idle(), 4)
        assert not scheduler.failures
        assert await inbox.pending_lanes(room_id='room', kind='game') == ()
        assert (await pool.execute("SELECT count(*) FROM game_commands WHERE status='accepted'")).rows == [(2,)]
        assert (await pool.execute("SELECT count(*) FROM game_commands WHERE status='rejected'")).rows == [(1,)]
    finally:
        await scheduler.stop()
        await host.close()
        await second_host.close()


async def test_cancelled_attempt_rolls_back_and_next_attempt_rebuilds(database, monkeypatch):
    import asyncio
    pool, checkpoints, fence, users = database
    host, game, inbox, lane, executor = await setup_game(database)
    try:
        actor, request = command(game)
        await inbox.enqueue(lane, actor, request)
        initial = await checkpoints.load(game.table.table_id)
        entered = asyncio.Event()
        outbox = executor._outbox
        async def pause(claim, events):
            await outbox(claim, events)
            entered.set()
            await asyncio.Event().wait()
        monkeypatch.setattr(executor, '_outbox', pause)
        task = asyncio.create_task(executor.execute_one(lane, fence))
        await asyncio.wait_for(entered.wait(), 2)
        task.cancel()
        with pytest.raises(asyncio.CancelledError): await task
        assert (await checkpoints.load(game.table.table_id)).checkpoint == initial.checkpoint
        assert (await pool.execute('SELECT count(*) FROM notification_outbox')).rows == [(0,)]
        monkeypatch.setattr(executor, '_outbox', outbox)
        assert (await executor.execute_one(lane, fence)).outcome['status'] == 'accepted'
    finally:
        await host.close()


async def test_flush_executes_continuation_and_enqueues_one_round_settlement(database):
    from app.durable_games.recovery import rebuild_hosted_game
    pool, checkpoints, fence, users = database
    host, game, inbox, lane, executor = await setup_game(database, 'flush')
    try:
        for name in ('DEAL_CARDS', 'SKIP_CUT', 'FOLD'):
            stored = await checkpoints.load(game.table.table_id)
            detached = rebuild_hosted_game(host, stored.checkpoint, receipt_snapshot=stored.receipt_snapshot).game
            actor, request = command(detached, name)
            await inbox.enqueue(lane, actor, request)
            assert (await executor.execute_one(lane, fence)).outcome['status'] == 'accepted'
        stored = await checkpoints.load(game.table.table_id)
        assert stored.checkpoint['data']['phase'] == 'OPEN'
        assert stored.checkpoint['data']['engine']['state']['status'] == 'finished'
        assert stored.receipt_snapshot['receipt_count'] == 3
        assert (await pool.execute('SELECT round_number,job_type FROM game_finalization_jobs')).rows == [(1, 'hosted_settlement')]
        assert (await pool.execute('SELECT count(*) FROM active_game_players')).rows == [(0,)]
    finally:
        await host.close()


async def test_same_deal_declarations_survive_durable_execution_and_recovery(database):
    from app.adapters.marriage.concurrency import declaration_phase_id
    pool, checkpoints, fence, users = database
    host, game = await host_game(users, 'marriage', started=False)
    try:
        game.marriage_scoring = replace(game.marriage_scoring, initial_tunnela_declaration=True)
        await host.table_command('room', users[0], game.match_id, 'lock')
        await host.start('room', users[0], game.match_id)
        game.durable_game_id = UUID(game.match_id)
        await checkpoints.save(capture_checkpoint(game, table_revision=0), expected_revision=None, fence=fence)
        inbox = PostgresInboxStore(pool)
        lane = await inbox.ensure_lane(LaneTarget(kind='game', room_id='room',
            table_id=UUID(game.table.table_id), game_id=game.durable_game_id))
        requests = []
        for user in users[:2]:
            request = ReliableActionCommand(match_id=game.match_id, command_id=uuid4().hex,
                expected_revision=1, command='DECLARE_TUNNELAS',
                payload={'melds': [], 'declaration_phase_id': declaration_phase_id(game.match_id)}).model_dump(mode='json')
            requests.append(request)
            await inbox.enqueue(lane, user, request)
        first = await GameLaneExecutor(inbox).execute_one(lane, fence)
        assert first.outcome['status'] == 'accepted' and first.outcome['revision'] == 2
        # A fresh executor rebuilds the game solely from its committed checkpoint.
        second = await GameLaneExecutor(inbox).execute_one(lane, fence)
        assert second.outcome['status'] == 'accepted' and second.outcome['revision'] == 3
        loaded = await checkpoints.load(game.table.table_id)
        assert loaded.receipt_snapshot['receipt_count'] == 2
        state = loaded.checkpoint['data']['engine']['state']
        assert all(p['tunnela_declared'] for p in state['players'])
        assert (await inbox.enqueue(lane, users[0], requests[0])).outcome == first.outcome
        stale = ReliableActionCommand(match_id=game.match_id, command_id=uuid4().hex,
            expected_revision=1, command='DRAW_CARD', payload={'source': 'stock'}).model_dump(mode='json')
        await inbox.enqueue(lane, users[0], stale)
        assert (await GameLaneExecutor(inbox).execute_one(lane, fence)).outcome['status'] == 'rejected'
        assert (await checkpoints.load(game.table.table_id)).checkpoint == loaded.checkpoint
    finally:
        await host.close()


async def test_same_hand_reviews_survive_durable_execution_and_recovery(database):
    from callbreak import Phase
    from app.adapters.callbreak.concurrency import hand_review_phase_id
    pool, checkpoints, fence, users = database
    host, game = await host_game(users, 'callbreak')
    try:
        while game.state.phase != Phase.HAND_REVIEW:
            await advance(host, game, {Phase.AWAITING_SHUFFLE: 'SHUFFLE_DECK',
                Phase.AWAITING_CUT: 'SKIP_CUT', Phase.AWAITING_DISTRIBUTION: 'START_DISTRIBUTION'}[game.state.phase])
        revision = game.state.revision
        phase = hand_review_phase_id(game.state, game.match_id)
        await checkpoints.save(capture_checkpoint(game, table_revision=0), expected_revision=None, fence=fence)
        inbox = PostgresInboxStore(pool)
        lane = await inbox.ensure_lane(LaneTarget(kind='game', room_id='room',
            table_id=UUID(game.table.table_id), game_id=game.durable_game_id))
        requests = []
        for user in users[:4]:
            request = ReliableActionCommand(match_id=game.match_id, command_id=uuid4().hex,
                expected_revision=revision, command='ACCEPT_HAND',
                payload={'hand_review_phase_id': phase}).model_dump(mode='json')
            requests.append(request)
            await inbox.enqueue(lane, user, request)
        outcomes = []
        for _ in requests:
            result = await GameLaneExecutor(inbox).execute_one(lane, fence)
            assert result.outcome['status'] == 'accepted'
            outcomes.append(result.outcome)
        loaded = await checkpoints.load(game.table.table_id)
        assert loaded.checkpoint['data']['engine']['state']['phase'] == 'BIDDING'
        assert (await inbox.enqueue(lane, users[0], requests[0])).outcome == outcomes[0]
        stale = dict(requests[0], command_id=uuid4().hex, expected_revision=outcomes[-1]['revision'])
        await inbox.enqueue(lane, users[0], stale)
        assert (await GameLaneExecutor(inbox).execute_one(lane, fence)).outcome['status'] == 'rejected'
        assert (await checkpoints.load(game.table.table_id)).checkpoint == loaded.checkpoint
    finally:
        await host.close()

@pytest.mark.parametrize('later_turn',[False,True])
async def test_marriage_long_show_order_is_private_and_recoverable_in_sql_lane(database,later_turn):
    from marriage import PlayerState, validate_game_state
    from marriage.queries import player_view
    from marriage import create_deck, Meld, MeldType
    from app.durable_games.checkpoints import decode_checkpoint
    pool,checkpoints,fence,users=database
    host,game=await host_game(users,'marriage')
    try:
        engine=game.marriage_target.adapter.checkpoint()
        state=engine.get_state()
        cards={c.card_id:c for c in create_deck()}
        melds=tuple(Meld(MeldType.PURE_SEQUENCE,tuple(f'D0:{r}{s}' for r in range(2,2+size))) for s,size in zip('CHS',(5,5,3)))
        selected=tuple(cards[i] for g in melds for i in g.card_ids)
        rest=tuple(c for c in cards.values() if c not in selected)
        hand=selected+rest[:8];rest=rest[8:]
        engine._state=replace(state,players=(PlayerState('1',hand),PlayerState('2',rest[:21])),stock=rest[22:],discard=rest[21:22])
        validate_game_state(engine.get_state())
        from app.multiplayer.table_session import sync
        import time
        sync(game,time.time())
        await checkpoints.save(capture_checkpoint(game,table_revision=0),expected_revision=None,fence=fence)
        inbox=PostgresInboxStore(pool)
        lane=await inbox.ensure_lane(LaneTarget(kind='game',room_id='room',table_id=UUID(game.table.table_id),game_id=game.durable_game_id))
        executor=GameLaneExecutor(inbox)
        async def current():
            loaded=await checkpoints.load(game.table.table_id)
            return loaded,decode_checkpoint(loaded.checkpoint).engine_state
        async def submit(command,payload,actor=0):
            _,before=await current()
            request=ReliableActionCommand(match_id=game.match_id,command_id=uuid4().hex,expected_revision=before.revision,command=command,payload=payload).model_dump(mode='json')
            await inbox.enqueue(lane,users[actor],request)
            result=await executor.execute_one(lane,fence)
            assert result.outcome['status']=='accepted',result.outcome
            assert (await inbox.enqueue(lane,users[actor],request)).outcome==result.outcome
            return await current()
        if later_turn:
            for actor in range(2):
                _,drawn=await submit('DRAW_CARD',{'source':'stock'},actor)
                await submit('DISCARD_CARD',{'card_id':drawn.players[actor].hand[-1].card_id},actor)
            await submit('DRAW_CARD',{'source':'stock'})
        before,_=await current()
        loaded,shown=await submit('SHOW_INITIAL_MELDS',{'melds':[{'meld_type':g.meld_type.value,'card_ids':list(g.card_ids)} for g in melds]})
        assert shown.players[0].has_seen_maal is (not later_turn)
        assert shown.tiplu is not None
        assert (player_view(shown,'1').maal is not None) is (not later_turn)
        assert player_view(shown,'2').maal is None
        assert {seat:(turn['token'],turn['user_id']) for seat,turn in loaded.checkpoint['data']['host']['session']['turns'].items()}=={seat:(turn['token'],turn['user_id']) for seat,turn in before.checkpoint['data']['host']['session']['turns'].items()}
        # A fresh executor reads the committed pending state, not this test host.
        executor=GameLaneExecutor(inbox)
        if not later_turn:
            _,shown=await submit('DRAW_CARD',{'source':'stock'})
        _,finished_turn=await submit('DISCARD_CARD',{'card_id':shown.players[0].hand[-1].card_id})
        assert finished_turn.players[0].has_seen_maal
        assert len([e for e in finished_turn.history if e.kind=='TIPLU_REVEALED'])==1
        assert player_view(finished_turn,'1').maal is not None
        assert player_view(finished_turn,'2').maal is None
        assert finished_turn.current_player_id=='2'
    finally:
        await host.close()

@pytest.mark.parametrize('dublee',[False,True])
async def test_unseen_marriage_finish_is_atomic_durable_and_settles_once(database,dublee):
    from marriage import create_deck,PlayerState,validate_game_state
    from app.durable_games.checkpoints import decode_checkpoint
    pool,checkpoints,fence,users=database
    count=4 if dublee else 2
    host,game=await host_game(users,'marriage',count=count)
    try:
        engine=game.marriage_target.adapter.checkpoint();state=engine.get_state()
        deck={c.card_id:c for c in create_deck()}
        groups=([{'meld_type':'dublee','card_ids':[f'D0:{r}C',f'D1:{r}C']} for r in range(2,10)] if dublee else
                [{'meld_type':'pure_sequence','card_ids':[f'D0:{r}{s}' for r in range(2,9)]} for s in 'CDH'])
        ids=tuple(i for g in groups for i in g['card_ids'])+(tuple(f'D0:{r}S' for r in (2,4,6,8,10)) if dublee else ())
        hand=tuple(deck[i] for i in ids);draw=deck['MAN:0']
        rest=tuple(c for c in deck.values() if c not in hand+(draw,))
        others=tuple(PlayerState(str(i+2),rest[i*21:(i+1)*21]) for i in range(count-1));stock=rest[(count-1)*21:]
        engine._state=replace(state,players=(PlayerState('1',hand),)+others,stock=stock[1:]+(draw,),discard=stock[:1])
        validate_game_state(engine.get_state())
        await checkpoints.save(capture_checkpoint(game,table_revision=0),expected_revision=None,fence=fence)
        inbox=PostgresInboxStore(pool)
        lane=await inbox.ensure_lane(LaneTarget(kind='game',room_id='room',table_id=UUID(game.table.table_id),game_id=game.durable_game_id))
        async def submit(command,payload):
            loaded=await checkpoints.load(game.table.table_id)
            revision=decode_checkpoint(loaded.checkpoint).engine_state.revision
            request=ReliableActionCommand(match_id=game.match_id,command_id=uuid4().hex,expected_revision=revision,command=command,payload=payload).model_dump(mode='json')
            await inbox.enqueue(lane,users[0],request)
            result=await GameLaneExecutor(inbox).execute_one(lane,fence)
            assert result.outcome['status']=='accepted',result.outcome
            assert (await inbox.enqueue(lane,users[0],request)).outcome==result.outcome
            return result
        await submit('DRAW_CARD',{'source':'stock'})
        await submit('FINISH',{'pairs' if dublee else 'melds':groups,'discard_card_id':'MAN:0'})
        loaded=await checkpoints.load(game.table.table_id)
        ended=decode_checkpoint(loaded.checkpoint).engine_state
        assert ended.winner=='1' and not ended.players[0].has_seen_maal and ended.tiplu is None
        assert len(ended.players[0].hand)==21 and ended.discard[-1].card_id=='MAN:0'
        jobs=await pool.execute("SELECT count(*) FROM game_finalization_jobs WHERE game_id=%s AND job_type='hosted_settlement'",(game.durable_game_id,))
        assert (await jobs.fetchone())[0]==1
        from marriage.queries import player_view
        assert player_view(ended,'1').maal is None
        assert await GameLaneExecutor(inbox).execute_one(lane,fence) is None
    finally:
        await host.close()
