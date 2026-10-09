from copy import deepcopy
from dataclasses import replace
from random import Random

import pytest
from app.multiplayer import table_session as policy
from app.durable_games.checkpoints import capture_checkpoint, decode_checkpoint
from app.durable_games.recovery import rebuild_hosted_game
from app.runtime.command_runtime import CommandAccessError
from app.adapters.callbreak.host import CallBreakCommandTarget
from test_hosted_checkpoints import make_host, start, action, engine_state, resign


@pytest.mark.parametrize('kind', ['callbreak','marriage','flush'])
async def test_all_games_idle_expiry_is_thirty_minutes_and_releases_every_position(kind):
    host, game = await make_host(kind)
    try:
        policy.sync(game, 100)
        game.table.queue.append('watcher')
        policy.tick(host, game, 1899)
        assert not game.ended
        policy.sync(game, 1899, actor='u0', activity=True)
        assert game.session['idle_deadline'] == 3699
        policy.tick(host, game, 3699)
        assert game.ended and not game.table.queue
        assert capture_checkpoint(game, table_revision=1)['data']['positions'] == []
        assert game.table.events[-1]['event'] == 'TABLE_EXPIRED'
    finally:
        await host.close()


@pytest.mark.parametrize('kind', ['marriage','flush'])
async def test_action_timeout_folds_releases_and_resolves_round(kind):
    host, game = await make_host(kind)
    try:
        await start(host, game)
        if kind == 'flush':
            await action(host, game, 'DEAL_CARDS')
            await action(host, game, 'SKIP_CUT')
        policy.sync(game, 100)
        assert all(t['deadline']==280 for t in game.session['turns'].values())
        seat, turn = next(iter(game.session['turns'].items()))
        actor = turn['user_id']
        policy.tick(host, game, 279)
        assert not game.session['removed']
        policy.tick(host, game, 280)
        assert actor not in game.table.seats(game)
        assert game.session['removed'][actor] == 'ACTION_TIMEOUT'
        state = engine_state(game)
        p = next(p for p in state.players if p.player_id == seat)
        assert p.folded if kind=='marriage' else p.status.value=='folded'
        assert state.status.value=='finished'
        assert game.session['idle_deadline']==2080
        decode_checkpoint(capture_checkpoint(game, table_revision=1))
    finally:
        await host.close()


async def test_callbreak_unknown_presence_never_offers_and_autoplay_is_random_legal():
    host, game = await make_host('callbreak')
    try:
        await start(host, game)
        policy.sync(game, 10)
        policy.tick(host, game, 129, connections={}, candidates=['watcher'])
        assert all(c['offer'] is None for c in game.session['controls'].values())
        policy.tick(host, game, 130, connections={}, candidates=['watcher'])
        assert game.state.revision>1
        assert any(c['mode']=='auto' for c in game.session['controls'].values())
        assert all(c['offer'] is None for c in game.session['controls'].values())
        # Pure chooser has no hidden-state input; both alternatives are reachable.
        rng=Random(9)
        choices={policy.random_action('PLAY_CARD', legal_cards=['2S','3S'], random=rng)[1]['card'] for _ in range(100)}
        assert choices=={'2S','3S'}
    finally:
        await host.close()


async def test_known_disconnect_offers_fifo_private_control_and_return_priority():
    host, game = await make_host('callbreak')
    try:
        await start(host, game)
        policy.sync(game, 100)
        original='u0'; game.table.queue.append('queued')
        policy.tick(host, game, 219, connections={original:100.0}, candidates=['queued','watcher'])
        assert not game.session['controls']['1']['offer']
        policy.tick(host, game, 220, connections={original:100.0}, candidates=['queued','watcher'])
        assert game.session['controls']['1']['offer']['user_id']=='queued'
        assert policy.live_control(game,'queued','accept-live-seat',221) is None
        assert game.users[0]==original and game.table.seats(game)[0]=='queued'
        assert host._game_snapshot(game,original)['private'] is None
        assert host._game_snapshot(game,'queued')['your_player_id']==1
        with pytest.raises(CommandAccessError):
            CallBreakCommandTarget(host,game).authorize(original)
        assert policy.live_control(game,original,'reclaim-seat',222) is None
        assert game.table.seats(game)[0]==original
        assert CallBreakCommandTarget(host,game).authorize(original) is None
        assert host._game_snapshot(game,'queued')['private'] is None
    finally:
        await host.close()


async def test_simultaneous_reviews_do_not_extend_another_players_deadline():
    host, game=await make_host('callbreak')
    try:
        await start(host,game)
        for cmd in ['SHUFFLE_DECK','SKIP_CUT','START_DISTRIBUTION']:
            await action(host,game,cmd)
        policy.sync(game,100)
        assert len(game.session['turns'])==4
        await action(host,game,'ACCEPT_HAND',user='u0')
        policy.sync(game,200,actor='u0',activity=True)
        assert all(t['deadline']==220 for t in game.session['turns'].values())
        assert '1' not in game.session['turns']
    finally:
        await host.close()


async def test_autoplay_completes_every_preparation_and_legal_trick_without_hidden_strategy():
    from callbreak import GameQuery
    host,game=await make_host('callbreak')
    try:
        # Keep dealer selection here so every player-controlled phase is covered.
        await host.start('room','u0',game.match_id)
        policy.sync(game,100)
        for c in game.session['controls'].values():c['mode']='auto'
        policy.sync(game,101,actor='u0')
        now=300
        actions=0
        while not game.finished:
            query=GameQuery(game.state)
            old_phase=game.state.phase.value
            turn=query.get_turn()
            actor=turn['pending_players'][0] if turn['pending_players'] else None
            legal=query.get_player_view(actor)['legal_cards'] if actor else []
            revision=game.state.revision
            _,changed=policy.tick(host,game,now)
            assert changed and game.state.revision>revision
            if old_phase=='PLAYING':
                played=[l for l in game.log if l['event']=='CARD_PLAYED'][-1]
                assert played['payload']['card'] in legal
            actions+=1; now+=125
            assert actions<500
        assert game.session['turns']=={}
        assert game.session['idle_deadline']==now-125+1800
        decode_checkpoint(capture_checkpoint(game,table_revision=1))
    finally:await host.close()


async def test_replacement_return_waits_for_end_of_trick_and_survives_checkpoint():
    from callbreak import GameQuery
    from app.durable_games.view_generation import projected_view
    host,game=await make_host('callbreak')
    try:
        await start(host,game)
        for cmd in ['SHUFFLE_DECK','SKIP_CUT','START_DISTRIBUTION']:
            await action(host,game,cmd)
        for user in game.users:
            await action(host,game,'ACCEPT_HAND',user=user)
        for _ in range(4):await action(host,game,'PLACE_BID',{'amount':1})
        query=GameQuery(game.state)
        seat=game.state.current_player
        await action(host,game,'PLAY_CARD',{'card':query.get_player_view(seat)['legal_cards'][0]})
        policy.sync(game,100)
        c=game.session['controls']['1']
        c.update(user_id='watcher',mode='replacement')
        policy.sync(game,101)
        assert policy.live_control(game,'u0','reclaim-seat',102) is None
        assert c['return_pending'] and c['user_id']=='watcher'
        checkpoint=capture_checkpoint(game,table_revision=4)
        receipts=dict(match_id=game.match_id,revision=game.state.revision,receipt_count=0,receipt_limit=10000,receipts=[])
        from app.durable_games.executor import _DetachedHost
        newhost=_DetachedHost(8)
        restored=newhost.game=rebuild_hosted_game(newhost,checkpoint,receipt_snapshot=receipts).game
        assert restored.session['controls']['1']['return_pending']
        # Immutable view generation must be deterministic, including session clocks.
        assert projected_view(checkpoint,'watcher',{})==projected_view(checkpoint,'watcher',{})
        while GameQuery(restored.state).get_current_trick()['plays']:
            seat=restored.state.current_player
            card=GameQuery(restored.state).get_player_view(seat)['legal_cards'][0]
            newhost._apply_player(restored,seat,'PLAY_CARD',{'card':card})
            policy.sync(restored,105,actor=policy.controller(restored,seat))
        assert restored.session['controls']['1']['user_id']=='u0'
        assert not restored.session['controls']['1']['return_pending']
    finally:await host.close()


async def test_flush_preparation_timeout_does_not_stall_or_leave_pending_player_with_private_cards():
    host,game=await make_host('flush')
    try:
        await start(host,game)
        policy.sync(game,100)
        dealer=next(iter(game.session['turns'].values()))['user_id']
        policy.tick(host,game,280)
        assert game.session['removed'][dealer]=='TIMEOUT_PENDING_DEAL'
        await action(host,game,'SKIP_CUT')
        policy.resolve_pending_flush(game)
        policy.sync(game,300)
        assert dealer not in game.users
        assert game.session['removed'][dealer]=='ACTION_TIMEOUT'
        assert host._flush_snapshot(game,dealer)['flush']['private'] is None
        assert game.flush_open
        decode_checkpoint(capture_checkpoint(game,table_revision=1))
    finally:await host.close()


async def test_simultaneous_marriage_declarations_have_independent_three_minute_deadlines():
    host,game=await make_host('marriage',3)
    try:
        game.marriage_scoring=replace(game.marriage_scoring,initial_tunnela_declaration=True)
        await start(host,game)
        policy.sync(game,100)
        assert len(game.session['turns'])==3
        policy.tick(host,game,280)
        assert sum(p.folded for p in engine_state(game).players)==1
        assert all(t['deadline']==280 for t in game.session['turns'].values())
        policy.tick(host,game,280)
        assert game.finished
    finally:await host.close()


@pytest.mark.parametrize('accepted', [False,True])
async def test_flush_side_show_timeout_targets_the_required_responding_player(accepted):
    host,game=await make_host('flush',3)
    try:
        game.flush_rules=replace(game.flush_rules,minimum_bet_rounds_before_side_show=0,
            minimum_blind_rounds_before_show=0)
        await start(host,game)
        await action(host,game,'DEAL_CARDS')
        await action(host,game,'SKIP_CUT')
        # First and second bettors become seen; second requests the prior seat.
        await action(host,game,'SEE_CARDS')
        await action(host,game,'BET',{'amount':2})
        await action(host,game,'SEE_CARDS')
        await action(host,game,'REQUEST_SIDE_SHOW')
        public=game.flush_target.adapter.snapshot()['view']
        side=public['pending_side_show']
        if accepted:await action(host,game,'ACCEPT_SIDE_SHOW',user=next(u for u,s in game.flush_seats.items() if str(s)==side['target_id']))
        policy.sync(game,100)
        seat=side['requester_id'] if accepted else side['target_id']
        assert list(game.session['turns'])==[seat]
        policy.tick(host,game,280)
        assert next(u for u,s in game.flush_seats.items() if str(s)==seat) not in game.users
        assert game.flush_target.adapter.snapshot()['view']['pending_side_show'] is None
        decode_checkpoint(capture_checkpoint(game,table_revision=1))
    finally:await host.close()


async def test_flush_final_show_timeout_resolves_the_show_and_removes_its_target():
    host,game=await make_host('flush')
    try:
        game.flush_rules=replace(game.flush_rules,minimum_blind_rounds_before_show=0)
        await start(host,game)
        await action(host,game,'DEAL_CARDS')
        await action(host,game,'SKIP_CUT')
        await action(host,game,'SEE_CARDS')
        await action(host,game,'SHOW')
        public=game.flush_target.adapter.snapshot()['view']
        seat=public['pending_show']['target_id']
        policy.sync(game,100)
        assert list(game.session['turns'])==[seat]
        policy.tick(host,game,280)
        assert game.flush_open
        assert next(u for u,s in game.flush_seats.items() if str(s)==seat) not in game.users
        decode_checkpoint(capture_checkpoint(game,table_revision=1))
    finally:await host.close()
