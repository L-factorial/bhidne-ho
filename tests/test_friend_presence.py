from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import Response

from app.players.http import friends


@pytest.mark.asyncio
async def test_friend_presence_only_queries_accepted_friends_and_ignores_unknown():
    snapshot = {'friends': [{'user_id': uid} for uid in ['online', 'offline', 'unknown']],
                'incoming': [{'user_id': 'stranger'}], 'outgoing': []}
    async def observe(kind, uid):
        assert kind == 'user'
        assert uid != 'stranger'
        return SimpleNamespace(status='unknown' if uid == 'unknown' else 'observed',
                               connections=(object(),) if uid != 'offline' else ())
    store = SimpleNamespace(observe=AsyncMock(side_effect=observe))
    state = SimpleNamespace(players=SimpleNamespace(snapshot=AsyncMock(return_value=snapshot)),
                            distributed_server=SimpleNamespace(presence=SimpleNamespace(store=store)))
    request = SimpleNamespace(app=SimpleNamespace(state=state))
    response = Response()
    result = await friends(request, response, SimpleNamespace(user_id='me'), True)
    assert result['online_friend_ids'] == ['online']
    assert 'online_friend_ids' not in snapshot
    assert response.headers['Cache-Control'] == 'no-store'
    store.observe.reset_mock()
    assert await friends(request, Response(), SimpleNamespace(user_id='me'), False) == snapshot
    store.observe.assert_not_awaited()


@pytest.mark.asyncio
async def test_no_presence_provider_does_not_invent_online_friends():
    state = SimpleNamespace(players=SimpleNamespace(snapshot=AsyncMock(return_value={
        'friends': [{'user_id': 'friend'}], 'incoming': [], 'outgoing': []})))
    result = await friends(SimpleNamespace(app=SimpleNamespace(state=state)), Response(),
                           SimpleNamespace(user_id='me'), True)
    assert result['online_friend_ids'] == []
