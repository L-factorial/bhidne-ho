"""Exercise native-process account setup without requiring native service binaries."""
from uuid import uuid4

from test_checkpoint_store import database
from test_distributed_platform import application
from test_distributed_processes import signup, submit


async def test_process_account_can_post_chat_with_redis_unavailable(database):
    # The application fixture deliberately keeps its Redis broker offline.
    async with application(database[0]) as (client, app, server):
        _, headers = await signup(client, 'http://test', 'process_setup')
        response = await client.post('/distributed/rooms', headers=headers, json={
            'command_id': uuid4().hex, 'name': 'Process setup',
            'visibility': 'public', 'invitees': [],
        })
        assert response.status_code == 200, response.text
        result, _ = await submit(client, 'http://test', headers,
            {'kind': 'room_chat', 'room_id': response.json()['room_id']},
            'send-chat', {'text': 'Process test setup completed'})
        assert result['status'] == 'accepted', result
        history = await client.get('/distributed/history/chat/' + result['lane_id'], headers=headers)
        assert history.status_code == 200, history.text
        assert history.json()['items'][0]['text'] == 'Process test setup completed'
