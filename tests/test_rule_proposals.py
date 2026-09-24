import asyncio
from copy import deepcopy

import pytest
from fastapi import HTTPException

from app.test_games.http import GameSettings, MarriageSettings, FlushSettings, RuleVote
from app.multiplayer.participation import GameParticipation
from app.multiplayer.player_profiles import PlayerProfileService
from app.multiplayer.room_chat import RoomChatService, ChatAccessDenied
from tests.test_table_formation import make, start, cmd
from tests.test_test_games import next_action
from callbreak import Phase


async def propose(host, game):
    snapshot = await host.snapshot('r', 'u0')
    if game.game_type == 'callbreak':
        return await host.configure('r', 'u0', GameSettings(match_id=game.match_id, weak_hand_enabled=False))
    if game.game_type == 'marriage':
        return await host.configure_marriage('r', 'u0', MarriageSettings(match_id=game.match_id,
            scoring={**snapshot['marriage_scoring'], 'seen_payment': 7, 'alter': [2, 5, 10], 'initial_tunnela_declaration': False}))
    settings = snapshot['flush_settings']
    return await host.configure_flush('r', 'u0', FlushSettings(match_id=game.match_id,
        rules_revision=settings['rules_revision'], rules={**settings['rules'], 'initial_blind_bet': 7}))


def current(snapshot):
    return snapshot.get('flush_settings') or snapshot.get('marriage_scoring') or snapshot['settings']


async def vote(host, game, who, accept, proposal_id=None):
    return await host.vote_rules('r', who, RuleVote(match_id=game.match_id,
        proposal_id=proposal_id or game.rule_proposal['id'], accept=accept))


@pytest.mark.parametrize('kind', ['callbreak', 'marriage', 'flush'])
async def test_rules_require_every_seated_vote_and_viewers_cannot_vote(kind):
    host, game, _ = await make(kind, capacity=4)
    try:
        before = deepcopy(current(await host.snapshot('r', 'u0')))
        proposed = await propose(host, game)
        assert current(proposed) == before
        assert proposed['rule_proposal']['status'] == 'PENDING'
        waiter = await cmd(host, game, 'u4', 'join-queue')
        assert waiter['rule_proposal']['proposed'] == proposed['rule_proposal']['proposed']
        assert not waiter['rule_proposal']['can_vote']
        for observer in ('u4', 'u5'):
            with pytest.raises(HTTPException) as error:
                await vote(host, game, observer, True)
            assert error.value.status_code == 403
        with pytest.raises(HTTPException):
            await host.start('r', 'u0', game.match_id, rules_revision=0)
        if kind != 'callbreak':
            with pytest.raises(HTTPException): await cmd(host, game, 'u0', 'lock')
        with pytest.raises(HTTPException): await propose(host, game)
        await vote(host, game, 'u1', True)
        await vote(host, game, 'u1', True)  # Retry does not count twice.
        assert game.rule_proposal['accepted'] == ['u0', 'u1']
        await vote(host, game, 'u2', True)
        assert current(await host.snapshot('r', 'u2')) == before
        accepted = await vote(host, game, 'u3', True)
        assert accepted['rule_proposal']['status'] == 'ACCEPTED'
        assert current(accepted) != before
        if kind == 'marriage':
            assert tuple(current(accepted)['alter']) == (2, 5, 10)
            assert current(accepted)['initial_tunnela_declaration'] is False
        assert (await vote(host, game, 'u3', True))['rule_proposal']['status'] == 'ACCEPTED'
        if kind != 'callbreak': await cmd(host, game, 'u0', 'lock')
        await host.start('r', 'u0', game.match_id, rules_revision=game.flush_rules_revision)
        if kind == 'marriage':
            running = await host.snapshot('r', 'u0')
            assert running['marriage']['public']['tunnela_declaration_pending'] is False
    finally:
        await host.close()


@pytest.mark.parametrize('kind', ['callbreak', 'marriage', 'flush'])
async def test_rejection_keeps_rules_and_roster_change_cancels_pending_vote(kind):
    host, game, _ = await make(kind, capacity=4)
    try:
        before = deepcopy(current(await host.snapshot('r', 'u0')))
        await propose(host, game)
        old_id = game.rule_proposal['id']
        await asyncio.gather(vote(host, game, 'u1', True), vote(host, game, 'u2', False))
        assert game.rule_proposal['status'] == 'REJECTED'
        assert current(await host.snapshot('r', 'u0')) == before
        await vote(host, game, 'u2', False)
        await propose(host, game)
        with pytest.raises(HTTPException): await vote(host, game, 'u3', True, old_id)
        await cmd(host, game, 'u1', 'leave-seat')
        assert game.rule_proposal['status'] == 'CANCELLED'
        with pytest.raises(HTTPException): await vote(host, game, 'u2', True)
        assert current(await host.snapshot('r', 'u0')) == before
    finally:
        await host.close()


@pytest.mark.parametrize('kind', ['callbreak', 'marriage', 'flush'])
async def test_chat_open_before_start_and_for_waiters_but_paused_for_active_players(kind):
    host, game, _ = await make(kind, capacity=4)
    chat = RoomChatService(host.rooms, PlayerProfileService(), GameParticipation(host))
    try:
        await cmd(host, game, 'u4', 'join-queue')
        assert await chat.history('r', 'u0') == []
        if kind != 'callbreak':
            await cmd(host, game, 'u0', 'lock')
            assert await chat.history('r', 'u0') == []
        await host.start('r', 'u0', game.match_id, rules_revision=0)
        for player in ('u0', 'u1'):
            with pytest.raises(ChatAccessDenied): await chat.history('r', player)
            with pytest.raises(ChatAccessDenied): await chat.send('r', player, 'No')
        assert (await chat.send('r', 'u4', 'Waiting'))['text'] == 'Waiting'
        assert (await chat.send('r', 'u5', 'Watching'))['text'] == 'Watching'
        await host.end('r', 'u0', game.match_id)
        assert len(await chat.history('r', 'u0')) == 2
    finally:
        await host.close()


async def test_callbreak_chat_reopens_after_deal_until_next_deal_starts():
    host, game, _ = await make(capacity=4)
    host.round_summary_seconds = 8
    chat = RoomChatService(host.rooms, PlayerProfileService(), GameParticipation(host))
    try:
        await start(host, game)
        while game.state.phase != Phase.DEAL_COMPLETE:
            actor, action = next_action(host, game)
            await host.action('r', actor, action)
        assert host.is_playing('r', 'u0')  # Match/seat semantics remain active.
        assert (await chat.send('r', 'u0', 'Nice deal'))['text'] == 'Nice deal'
        assert (await host.snapshot('r', 'u0'))['chat_enabled']
        await host.next_deal('r', 'u0', game.match_id, 1)
        with pytest.raises(ChatAccessDenied): await chat.history('r', 'u0')
    finally:
        await host.close()
