from random import Random
from dataclasses import replace

import pytest
from pydantic import ValidationError
from flush import FlushGameEngine, FlushRulesConfig
from app.adapters.flush import FlushAdapter, PlayerCommand, AdapterResult, CommandRejected
from app.adapters.flush.contracts import OutboundEvent, RoutedEvent, COMMAND_SPECS


def adapter():
    return FlushAdapter(FlushGameEngine(['1', '2'], initial_chips={'1': 100, '2': 100},
        rules=FlushRulesConfig(5, 10, minimum_bet_rounds_before_side_show=0, minimum_blind_rounds_before_show=0),
        rng=Random(4)), match_id='m', owner_player_id='1')


def send(a, name, seat='1', payload=None, revision=None):
    return a.dispatch_player(PlayerCommand(match_id='m', command_id=name + str(a.revision),
        expected_revision=a.revision if revision is None else revision, command=name, payload=payload or {}), player_id=seat)


def test_catalog_commands_private_queries_and_public_show():
    a = adapter()
    assert send(a, 'START_GAME', '2').code == 'OWNER_REQUIRED'
    start = send(a, 'START_GAME')
    send(a, 'DEAL_CARDS')
    send(a, 'SKIP_CUT', '2')
    assert isinstance(start, AdapterResult)
    assert 'cards' not in a.snapshot()['view']['players'][0]
    assert all(a.snapshot(p)['view']['cards'] == [] for p in a.seat_ids)
    assert send(a, 'BET', '1', {'amount': 10}).code == 'INVALID_TURN'
    assert send(a, 'BET', '2', {'amount': 10}, revision=0).code == 'STALE_REVISION'
    seen = send(a, 'SEE_CARDS', '2')
    assert isinstance(seen, AdapterResult)
    private = [r for r in seen.messages if r.recipient_player_id]
    assert len(private) == 2
    assert private[0].message.payload['view']['cards'] == []
    assert len(private[1].message.payload['view']['cards']) == 3
    assert all(not r.message.payload['event']['shown_hands'] for r in seen.messages if not r.recipient_player_id)
    for name in ('GET_STATE', 'GET_ALLOWED_ACTIONS', 'CAN_SEE_CARDS', 'CAN_SHOW', 'GET_EVENTS'):
        before = a.checkpoint()
        result = send(a, name, '2')
        assert isinstance(result, AdapterResult) and a.checkpoint() is before
        assert len(result.messages) == 1 and result.messages[0].recipient_player_id == '2'
    pending = send(a, 'SHOW', '2')
    assert isinstance(pending, AdapterResult)
    result = send(a, 'REVEAL_CARDS', '1')
    assert isinstance(result, AdapterResult)
    finish = next(r for r in result.messages if r.message.event == 'ROUND_FINISHED')
    assert len(finish.message.payload['event']['shown_hands']) == 2
    assert send(a, 'FOLD', '2').code == 'INVALID_ACTION'


def test_failed_projection_does_not_install_mutation(monkeypatch):
    import app.adapters.flush.adapter as module
    a = adapter()
    send(a, 'START_GAME')
    send(a, 'DEAL_CARDS')
    send(a, 'SKIP_CUT', '2')
    before = a.checkpoint()
    def fail(**kwargs):
        raise ValueError('projection failure')
    monkeypatch.setattr(module, 'OutboundEvent', fail)
    with pytest.raises(ValueError):
        send(a, 'BET', '2', {'amount': 10})
    assert a.checkpoint() is before and a.revision == 3


@pytest.mark.parametrize('extra', [{'player_id': '2'}, {'recipient': '2'}, {'room_id': 'other'}, {'protocol_version': True}])
def test_spoofed_envelopes_rejected(extra):
    with pytest.raises(ValidationError):
        PlayerCommand(match_id='m', command_id='c', expected_revision=0, command='GET_STATE', **extra)


@pytest.mark.parametrize('command,payload', [('BET', {'amount': True}), ('BET', {'amount': 10.0}),
    ('BET', {'amount': 0}), ('SEE_CARDS', {'player_id': '1'}), ('GET_STATE', {'player_id': '1'}),
    ('GET_EVENTS', {'after_sequence': -1})])
def test_invalid_payloads(command, payload):
    with pytest.raises(ValidationError):
        PlayerCommand(match_id='m', command_id='c', expected_revision=0, command=command, payload=payload)


def test_outbound_audience_and_hidden_fields_are_checked():
    a = adapter()
    result = send(a, 'START_GAME')
    private = next(r for r in result.messages if r.recipient_player_id)
    with pytest.raises(ValidationError):
        RoutedEvent(message=private.message, recipient_player_id='wrong')
    public = result.messages[0].message.model_dump(mode='json')
    public['payload']['event']['shown_hands'] = [['1', ['AS', 'KH', 'QD']]]
    with pytest.raises(ValidationError):
        OutboundEvent.model_validate(public)


async def test_registered_target_retries_and_rolls_back_before_delivery(monkeypatch):
    from app.adapters.flush import register_flush
    from app.runtime.game_registry import GameRegistry
    from app.runtime.command_runtime import CommandRuntime, CommandAccessError
    from app.models.action import ReliableActionCommand
    a = adapter()
    registry = GameRegistry()
    target = register_flush(registry, 'r', adapter=a, seat_by_user={'alice': '1', 'bob': '2'})
    session = registry.get_room('r').commands
    assert session.match_id == 'm'
    runtime, delivered = CommandRuntime(), []
    async def deliver(events):
        delivered.extend(events)
    start = ReliableActionCommand(match_id='m', command_id='start', expected_revision=0, command='START_GAME')
    await runtime.execute(session, target, 'alice', start, deliver)
    for seat, name in [('alice', 'DEAL_CARDS'), ('bob', 'SKIP_CUT')]:
        await runtime.execute(session, target, seat, ReliableActionCommand(match_id='m', command_id=name, expected_revision=a.revision, command=name), deliver)
    before = a.checkpoint()
    wager = ReliableActionCommand(match_id='m', command_id='bet', expected_revision=3, command='BET', payload={'amount': 10})
    original = target.apply
    def fail(user, request):
        original(user, request)
        raise RuntimeError('injected failure')
    with monkeypatch.context() as patch:
        patch.setattr(target, 'apply', fail)
        with pytest.raises(RuntimeError):
            await runtime.execute(session, target, 'bob', wager, deliver)
    assert a.checkpoint() is before and ('bob', 'bet') not in session.receipts
    result = await runtime.execute(session, target, 'bob', wager, deliver)
    count = len(delivered)
    retry = await runtime.execute(session, target, 'bob', wager, deliver)
    assert retry['action_ack'] == result['action_ack'] and len(delivered) == count
    assert a.snapshot()['view']['pot'] == 20
    with pytest.raises(CommandAccessError):
        await runtime.execute(session, target, 'spectator', wager, deliver)
    with pytest.raises(ValueError):
        register_flush(registry, 'other', adapter=a, seat_by_user={'alice': '1', 'bob': '2'})


async def test_side_show_target_authorization_retry_and_private_unicast():
    from app.adapters.flush import register_flush
    from app.runtime.game_registry import GameRegistry
    from app.runtime.command_runtime import CommandRuntime
    from app.models.action import ReliableActionCommand
    e = FlushGameEngine(['1','2','3'], initial_chips=dict.fromkeys(['1','2','3'], 1000),
        rules=FlushRulesConfig(5, 10, allow_side_show=True, minimum_bet_rounds_before_side_show=0), rng=Random(5))
    a = FlushAdapter(e, match_id='side', owner_player_id='1')
    registry = GameRegistry()
    target = register_flush(registry, 'side-room', adapter=a, seat_by_user={'u1':'1','u2':'2','u3':'3'})
    session, runtime, delivered = registry.get_room('side-room').commands, CommandRuntime(), []
    async def deliver(events): delivered.extend(events)
    async def act(user, command, payload=None, command_id=None):
        request = ReliableActionCommand(match_id='side', command_id=command_id or command + str(a.revision),
            expected_revision=a.revision, command=command, payload=payload or {})
        result = await runtime.execute(session, target, user, request, deliver)
        return result, request
    await act('u1', 'START_GAME')
    await act('u1', 'DEAL_CARDS')
    await act('u2', 'SKIP_CUT')
    for user in ['u2', 'u3', 'u1']:
        await act(user, 'SEE_CARDS'); await act(user, 'BET', {'amount':20})
    result, request = await act('u2', 'REQUEST_SIDE_SHOW')
    pot = a.snapshot()['view']['pot']
    await runtime.execute(session, target, 'u2', request, deliver)
    assert a.snapshot()['view']['pot'] == pot
    result, _ = await act('u3', 'ACCEPT_SIDE_SHOW')
    assert result['action_ack']['status'] == 'rejected'
    delivered.clear()
    result, request = await act('u1', 'ACCEPT_SIDE_SHOW')
    assert result['action_ack']['status'] == 'accepted'
    assert a.snapshot()['view']['status'] == 'in_progress'
    for event in delivered:
        payload = event.message['payload']
        if event.message['event'] == 'PLAYER_STATE':
            if event.recipient in ('u1','u2'):
                assert len(payload['view']['side_show']['opponent_cards']) == 3
            else:
                assert payload['view']['side_show'] is None
        else:
            assert payload['event']['shown_hands'] == []
    revision = a.revision
    await runtime.execute(session, target, 'u1', request, deliver)
    assert a.revision == revision


async def test_nonowner_winner_starts_next_round_and_retry_is_idempotent():
    from app.adapters.flush import register_flush
    from app.runtime.game_registry import GameRegistry
    from app.runtime.command_runtime import CommandRuntime
    from app.models.action import ReliableActionCommand
    a = adapter()
    registry = GameRegistry()
    target = register_flush(registry, 'r', adapter=a, seat_by_user={'alice': '1', 'bob': '2'})
    session, runtime = registry.get_room('r').commands, CommandRuntime()
    async def deliver(events): pass
    async def act(user, name, payload=None):
        request = ReliableActionCommand(match_id='m', command_id=name + str(a.revision),
            expected_revision=a.revision, command=name, payload=payload or {})
        return await runtime.execute(session, target, user, request, deliver)
    await act('alice', 'START_GAME'); await act('alice', 'DEAL_CARDS'); await act('bob', 'SKIP_CUT')
    await act('bob', 'BET', {'amount': 10}); await act('alice', 'FOLD')
    assert a.snapshot()['view']['next_dealer_id'] == '2'
    denied = await act('alice', 'START_NEXT_ROUND')
    assert denied['action_ack']['status'] == 'rejected'
    request = ReliableActionCommand(match_id='m', command_id='next', expected_revision=a.revision, command='START_NEXT_ROUND')
    accepted = await runtime.execute(session, target, 'bob', request, deliver)
    retry = await runtime.execute(session, target, 'bob', request, deliver)
    assert accepted['action_ack'] == retry['action_ack']
    assert a.snapshot()['view']['round_number'] == 2
    assert a.snapshot()['view']['dealer_id'] == '2'
    assert len(a.snapshot()['view']['round_results']) == 1
