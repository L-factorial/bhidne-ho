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


async def test_legacy_flush_rules_restore_defaults_without_enabling_old_bonuses():
    from flush.rules import legacy_rule_defaults
    from flush import FlushRulesConfig
    rules = FlushRulesConfig(**legacy_rule_defaults({'boot_amount':7,'initial_blind_bet':7}))
    assert rules.allow_multiplayer_blind_show is False
    assert rules.ace_trial_bonus == 0


@pytest.mark.parametrize('kind', ['callbreak', 'marriage', 'flush'])
async def test_creator_config_applies_immediately_and_notifies_without_votes(kind):
    host, game, _ = await make(kind, capacity=4)
    try:
        before = deepcopy(current(await host.snapshot('r','u0')))
        saved = await propose(host,game)
        assert current(saved) != before
        assert saved['rule_proposal']['status'] == 'ACCEPTED'
        assert not saved['rule_proposal']['can_vote']
        assert any(e['event']=='GAME_CONFIG_UPDATED' for e in game.table.events)
        assert current(await host.snapshot('r','u1')) == current(saved)
        with pytest.raises(HTTPException):
            await host.configure('r','u1',GameSettings(match_id=game.match_id,weak_hand_enabled=True))
        if kind != 'callbreak': await cmd(host,game,'u0','lock')
        await host.start('r','u0',game.match_id,rules_revision=game.flush_rules_revision)
        with pytest.raises(HTTPException): await propose(host,game)
    finally:
        await host.close()


@pytest.mark.parametrize('kind', ['callbreak', 'marriage', 'flush'])
async def test_saved_config_survives_departure_and_cannot_be_rejected(kind):
    host, game, _ = await make(kind,capacity=4)
    try:
        saved = await propose(host,game)
        with pytest.raises(HTTPException): await vote(host,game,'u2',False)
        await host.leave('r','u1',game.match_id)
        assert game.rule_proposal['status']=='ACCEPTED'
        assert current(await host.snapshot('r','u0')) == current(saved)
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


async def test_completed_callbreak_host_can_save_next_config_without_changing_results():
    from tests.test_table_formation import completed
    host, game, _ = await completed()
    try:
        state = game.state
        await host.leave('r', 'u0', game.match_id)
        saved = await host.configure('r', 'u1', GameSettings(match_id=game.match_id, weak_hand_enabled=False))
        assert saved['is_creator']
        assert saved['rule_proposal']['status'] == 'ACCEPTED'
        assert game.state is state
        assert game.settings['weak_hand_enabled'] is False
    finally:
        await host.close()


async def test_flush_between_hands_config_is_used_by_the_next_deal():
    from dataclasses import replace
    host, game, _ = await make('flush',capacity=4)
    try:
        await start(host,game)
        engine=game.flush_target.adapter.checkpoint()
        engine.deal_cards(engine.get_state().current_player_id);engine.skip_cut(engine.get_state().current_player_id)
        while engine.get_state().settlement is None:engine.fold(engine.get_state().current_player_id)
        before=engine.get_state()
        saved=await propose(host,game)
        assert saved['rule_proposal']['status']=='ACCEPTED'
        assert engine.get_state() is before
        await cmd(host,game,'u0','lock')
        await host.start('r','u0',game.match_id,rules_revision=game.flush_rules_revision)
        assert game.flush_target.adapter.checkpoint().get_state().config.rules.initial_blind_bet==7
        assert game.flush_target.adapter.checkpoint().get_state().config.rules.boot_amount==7
    finally:
        await host.close()
