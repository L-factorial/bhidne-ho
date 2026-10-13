from uuid import UUID

import pytest

from app.durable_games.queries import PostgresHostedQueries
from test_checkpoint_store import database


async def test_lobby_visibility_sources_profiles_and_pagination(database):
    pool, _, _, users = database
    for name, creator, visibility in [('public', 3, 'public'), ('friend', 2, 'public'),
                                      ('hidden', 2, 'private'), ('invited', 2, 'private'),
                                      ('joined', 3, 'private')]:
        await pool.execute('INSERT INTO rooms(id,creator_id,name,visibility) VALUES (%s,%s,%s,%s)',
                           (name, UUID(int=creator), name, visibility))
    await pool.execute("INSERT INTO friendships(user_low,user_high,requested_by,status) VALUES (%s,%s,%s,'accepted')",
                       (UUID(int=1), UUID(int=2), UUID(int=1)))
    await pool.execute("INSERT INTO room_memberships(room_id,user_id) VALUES ('joined',%s)", (UUID(int=1),))
    await pool.execute("INSERT INTO room_invitations(id,room_id,inviter_id,recipient_id) VALUES ('invite','invited',%s,%s)",
                       (users[1], users[0]))
    queries = PostgresHostedQueries(pool)
    items, cursor = [], ''
    while True:
        page = await queries.lobby(users[0], after_room_id=cursor, limit=2)
        items.extend(page['items'])
        if page['next_room_id'] is None: break
        cursor = page['next_room_id']
    assert [(r['room_id'], r['feed_source']) for r in items] == [
        ('friend', 'friend'), ('hidden', 'friend'), ('invited', 'friend'),
        ('joined', 'joined'), ('public', 'public'), ('room', 'you')]
    own = items[-1]
    assert own['members'] == users
    assert own['table_count'] == 0
    assert len(own['member_previews']) == 4
    assert own['member_previews'][0]['user_id'] == users[0]
    assert 'connected_members' not in own
    assert isinstance(own['created_at'], float)
    assert (await pool.execute('SELECT count(*) FROM notification_outbox')).rows == [(0,)]
    # An invitation is visible in its own inbox, without changing room membership.
    assert (await queries.room_invitations(users[0]))['items'][0]['room_id'] == 'invited'
    assert 'invited' in [r['room_id'] for r in items]


@pytest.mark.parametrize('limit', [0, 101, True])
async def test_lobby_rejects_invalid_bounds(database, limit):
    pool, _, _, users = database
    with pytest.raises(ValueError):
        await PostgresHostedQueries(pool).lobby(users[0], limit=limit)


@pytest.mark.parametrize('kind', ['callbreak', 'marriage', 'flush'])
async def test_original_game_view_is_private_committed_and_does_not_fall_back_from_unknown_match(database, kind):
    from uuid import uuid4
    from test_checkpoint_store import host_game
    from app.durable_games.checkpoints import capture_checkpoint
    from app.durable_games.store import DurableGameNotFound
    pool, store, fence, users = database
    host, game = await host_game(users, kind)
    try:
        await store.save(capture_checkpoint(game, table_revision=0), expected_revision=None, fence=fence)
        before = await store.load(game.table.table_id)
        queries = PostgresHostedQueries(pool)
        default = await queries.game_view('room', users[0])
        selected = await queries.game_view('room', users[0], match_id=game.match_id)
        assert default == selected
        assert selected['match_id'] == game.match_id
        assert selected['table_id'] == game.table.table_id
        assert selected['table_revision'] == 0
        assert selected['game'] == host._snapshot(game, users[0])['game']
        with pytest.raises(DurableGameNotFound):
            await queries.game_view('room', users[0], match_id=uuid4())
        assert await store.load(game.table.table_id) == before
        assert (await pool.execute('SELECT count(*) FROM notification_outbox')).rows == [(0,)]
    finally:
        await host.close()


async def test_original_game_empty_room_and_membership_boundary(database):
    from app.durable_games.queries import QueryAccessDenied
    pool, _, _, users = database
    query = PostgresHostedQueries(pool)
    assert await query.game_view('room', users[0]) == dict(room_id='room', status='empty', tables=[])
    await pool.execute('DELETE FROM room_memberships WHERE user_id=%s', (UUID(users[-1][5:]),))
    with pytest.raises(QueryAccessDenied):
        await query.game_view('room', users[-1])


@pytest.mark.parametrize('kind', ['callbreak', 'marriage', 'flush'])
async def test_active_table_previews_do_not_grant_private_game_access(database, kind):
    from test_checkpoint_store import host_game
    from app.durable_games.checkpoints import capture_checkpoint
    from app.durable_games.queries import QueryAccessDenied
    pool, store, fence, users = database
    host, game = await host_game(users, kind)
    outsider = f'user-{UUID(int=99)}'
    await pool.execute("INSERT INTO users(id,kind) VALUES (%s,'account')", (UUID(int=99),))
    try:
        await store.save(capture_checkpoint(game, table_revision=0), expected_revision=None, fence=fence)
        query = PostgresHostedQueries(pool)
        assert (await query.activity(outsider))['items'] == []
        # Pending requests do not qualify; only accepted owner friendships do.
        await pool.execute("INSERT INTO friendships(user_low,user_high,requested_by,status) VALUES (%s,%s,%s,'pending')",
                           (UUID(int=1), UUID(int=99), UUID(int=99)))
        assert (await query.activity(outsider))['items'] == []
        await pool.execute("UPDATE friendships SET status='accepted' WHERE user_high=%s", (UUID(int=99),))
        public = await query.activity(outsider)
        assert len(public['items']) == 1
        assert public['items'][0]['match_id'] == game.match_id
        assert 'game' not in public['items'][0]
        assert public['items'][0]['room_name'] == 'Room'
        assert (await query.activity(outsider, memberships=True))['items'] == []
        with pytest.raises(QueryAccessDenied):
            await query.game_view('room', outsider, match_id=game.match_id)
        with pytest.raises(ValueError):
            await query.room('room', outsider, public_preview=True, select_default=True)
        await pool.execute('DELETE FROM friendships WHERE user_high=%s', (UUID(int=99),))
        assert (await query.activity(outsider))['items'] == []
        await pool.execute("INSERT INTO room_memberships(room_id,user_id) VALUES ('room',%s)", (UUID(int=99),))
        assert len((await query.activity(outsider))['items']) == 1
        await pool.execute('DELETE FROM room_memberships WHERE user_id=%s', (UUID(int=99),))
        assert (await query.activity(outsider))['items'] == []
        # Ownership alone qualifies even if the owner has left membership.
        await pool.execute("UPDATE rooms SET creator_id=%s WHERE id='room'", (UUID(int=99),))
        assert len((await query.activity(outsider))['items']) == 1
        await pool.execute("UPDATE rooms SET creator_id=%s WHERE id='room'", (UUID(int=1),))
        member = (await query.activity(users[0], memberships=True))['items'][0]
        assert member['room_id'] == 'room'
        assert member['active_game']['player_is_participant'] is True
    finally:
        await host.close()


async def test_invitation_preview_does_not_join_room_or_grant_member_profiles(database):
    from app.durable_games.queries import QueryAccessDenied
    pool, _, _, users = database
    query = PostgresHostedQueries(pool)
    await pool.execute('DELETE FROM room_memberships WHERE user_id=%s', (UUID(users[-1][5:]),))
    assert (await query.room('room', users[-1], invitation_preview=True))['snapshot'] is None
    await pool.execute("INSERT INTO room_invitations(id,room_id,inviter_id,recipient_id) VALUES ('i','room',%s,%s)",
                       (users[0], users[-1]))
    result = await query.room('room', users[-1], invitation_preview=True)
    assert result['name'] == 'Room'
    assert result['members'] == users[:-1]
    assert result['snapshot'] is None
    with pytest.raises(QueryAccessDenied):
        await query.member_profiles('room', users[-1])
    with pytest.raises(QueryAccessDenied):
        await query.game_view('room', users[-1])
    page = await query.member_profiles('room', users[0], limit=2)
    assert [p['user_id'] for p in page['items']] == users[:2]
    assert page['next_user_id'] == users[1]
    next_page = await query.member_profiles('room', users[0], after_user_id=page['next_user_id'])
    assert [p['user_id'] for p in next_page['items']] == users[2:-1]
    assert next_page['next_user_id'] is None
    await pool.execute("UPDATE room_invitations SET status='declined' WHERE id='i'")
    assert (await query.room('room', users[-1], invitation_preview=True))['snapshot'] is None


@pytest.mark.parametrize('kind', ['callbreak', 'marriage', 'flush'])
async def test_completed_reserved_seat_stays_in_play_until_leave_or_close(database, kind):
    from test_flush_restart import table_action
    from app.durable_games.inbox import LaneTarget
    pool, store, fence, users = database
    if kind == 'flush':
        from test_flush_restart import finished
        host, game, inbox, lane, *_ = await finished(database)
    else:
        from test_rematch import completed
        host, game, inbox, *_ = await completed(database, kind)
        lane = await inbox.ensure_lane(LaneTarget(kind='table', room_id='room', table_id=UUID(game.table.table_id)))
    try:
        query = PostgresHostedQueries(pool)
        results = (await query.activity(users[1]))['items']
        assert len(results) == 1
        assert results[0]['phase'] == ('OPEN' if kind == 'flush' else 'COMPLETED')
        assert results[0]['current_user']['is_seated'] is True
        assert any(t['match_id'] == game.match_id for t in (await query.room('room', users[1]))['tables'])
        # Room member with no seat must not discover unrelated completed games.
        if kind != 'flush':
            assert (await query.activity(users[-1]))['items'] == []
        assert (await table_action(database, game, inbox, lane, 'leave-seat', actor=users[1]))[0]['status'] == 'accepted'
        after_leave = (await query.activity(users[1]))['items']
        assert not any(t['current_user']['is_seated'] for t in after_leave)
        if kind != 'flush':
            assert after_leave == []
        assert (await table_action(database, game, inbox, lane, 'end', actor=users[0]))[0]['status'] == 'accepted'
        assert (await query.activity(users[0]))['items'] == []
    finally:
        await host.close()
