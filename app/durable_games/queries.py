"""Authorized committed projections, usable on any server without an owner host.

These explicit adapters are not installed in the legacy HTTP/WS composition.
Authorization and projection share one read-only PostgreSQL snapshot. Departure
committed before that snapshot denies access; a concurrent departure may finish
after it. No timers, settlements, ownership, or durable state advance on a read.
"""

from .telemetry import observe
from copy import deepcopy
from uuid import UUID
from psycopg.types.json import Jsonb

from app.test_games.service import TestGameService
from .checkpoint_store import PostgresCheckpointStore, user_uuid
from .recovery import rebuild_hosted_game
from .store import DurableGameConflict, DurableGameNotFound


class QueryAccessDenied(PermissionError):
    pass


async def require_member(connection, room_id, actor):
    user = user_uuid(actor)
    row = await (await connection.execute('''SELECT 1 FROM room_memberships
        WHERE room_id=%s AND user_id=%s
        AND NOT EXISTS (SELECT 1 FROM deleted_rooms WHERE id=%s)''', (room_id, user, room_id))).fetchone()
    if row is None:
        raise QueryAccessDenied('Room membership is required.')


class _Profiles:
    def __init__(self, names):
        self.names = names

    def name(self, user, seat):
        return self.names.get(user) or user


class _ProjectionHost(TestGameService):
    def _sync_proposal(self, game):
        # Only commands may cancel a committed proposal. Legacy projection calls
        # this hook, so override it rather than presenting speculative changes.
        pass


class PostgresHostedQueries:
    def __init__(self, pool, *, max_tables=5, round_summary_seconds=8):
        if type(max_tables) is not int or max_tables < 1 or round_summary_seconds < 0:
            raise ValueError('Invalid query limits.')
        self.pool, self.checkpoints = pool, PostgresCheckpointStore(pool)
        self.max_tables, self.round_summary_seconds = max_tables, round_summary_seconds

    async def invitation_eligibility(self, room_id, actor, recipients):
        from .invitations import eligibility
        if not 1 <= len(recipients) <= 20:
            raise ValueError('Supply 1 to 20 recipients.')
        async with self.pool.connection() as connection:
            async with connection.transaction():
                await connection.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY')
                await require_member(connection, room_id, actor)
                return await eligibility(connection, room_id, actor, recipients)

    @observe('read.catalog')
    async def catalog(self, actor, *, after_room_id='', limit=50):
        user = user_uuid(actor)
        if type(limit) is not int or not 1 <= limit <= 100:
            raise ValueError('Invalid catalog page limit.')
        async with self.pool.connection() as connection:
            rows = await (await connection.execute('''SELECT r.id,r.name,r.creator_id,r.visibility,r.created_at,
                r.open_table_count,EXISTS(SELECT 1 FROM room_memberships m WHERE m.room_id=r.id AND m.user_id=%s)
                FROM rooms r WHERE r.id>%s AND NOT EXISTS(SELECT 1 FROM deleted_rooms d WHERE d.id=r.id)
                AND (r.visibility='public' OR r.creator_id=%s OR EXISTS
                    (SELECT 1 FROM room_memberships m WHERE m.room_id=r.id AND m.user_id=%s)
                    OR EXISTS(SELECT 1 FROM room_invitations i WHERE i.room_id=r.id AND i.recipient_id=%s AND i.status='pending'))
                ORDER BY r.id LIMIT %s''', (user, after_room_id, user, user, actor, limit + 1))).fetchall()
            return dict(items=[dict(room_id=r[0], name=r[1], creator_id=f'user-{r[2]}', visibility=r[3],
                created_at=r[4].isoformat(), open_table_count=r[5], is_member=r[6]) for r in rows[:limit]],
                next_room_id=rows[limit - 1][0] if len(rows)>limit else None)

    @observe('read.lobby')
    async def lobby(self, actor, *, after_room_id='', limit=50):
        """Original room-card contract, from committed shared state.

        Invitation discovery remains separate: an invitation alone must not put a
        private room into the public/friend feed. Presence is deliberately absent
        here; membership is not evidence that a player is currently connected.
        Pagination uses stable IDs; the client sorts the complete feed by source
        and creation time, just as the original lobby does.
        """
        user = user_uuid(actor)
        if type(limit) is not int or not 1 <= limit <= 100:
            raise ValueError('Invalid lobby page limit.')
        async with self.pool.connection() as connection:
            async with connection.transaction():
                await connection.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY')
                rows = await (await connection.execute('''SELECT r.id,r.name,r.creator_id,r.visibility,r.created_at,
                    r.open_table_count,EXISTS(SELECT 1 FROM room_memberships m WHERE m.room_id=r.id AND m.user_id=%s) AS is_member,
                    EXISTS(SELECT 1 FROM friendships f WHERE f.status='accepted'
                        AND f.user_low=LEAST(r.creator_id,%s::uuid) AND f.user_high=GREATEST(r.creator_id,%s::uuid)) AS creator_is_friend
                    FROM rooms r WHERE r.id>%s AND NOT EXISTS(SELECT 1 FROM deleted_rooms d WHERE d.id=r.id)
                    AND (r.visibility='public' OR r.creator_id=%s OR EXISTS
                        (SELECT 1 FROM room_memberships m WHERE m.room_id=r.id AND m.user_id=%s))
                    ORDER BY r.id LIMIT %s''', (user, user, user, after_room_id, user, user, limit + 1))).fetchall()
                items = []
                for room, name, creator, visibility, created, tables, joined, friend in rows[:limit]:
                    members = await (await connection.execute('''SELECT m.user_id,
                        COALESCE(NULLIF(p.display_name,''),a.username),a.username
                        FROM room_memberships m LEFT JOIN user_profiles p ON p.user_id=m.user_id
                        LEFT JOIN account_credentials a ON a.user_id=m.user_id
                        WHERE m.room_id=%s ORDER BY m.user_id LIMIT 1001''', (room,))).fetchall()
                    # Never silently turn a truncated member list into a false
                    # count or false membership decision in an existing card.
                    if len(members) > 1000:
                        raise DurableGameConflict('Room exceeds the lobby membership limit.')
                    items.append(dict(room_id=room, name=name, creator_id=f'user-{creator}',
                        visibility=visibility, created_at=created.timestamp(), table_count=tables,
                        members=[f'user-{m[0]}' for m in members], creator_is_friend=friend,
                        member_previews=[dict(user_id=f'user-{m[0]}', display_name=m[1] or f'user-{m[0]}',
                                              username=m[2]) for m in members[:4]],
                        feed_source='you' if creator == user else 'joined' if joined else 'friend' if friend else 'public'))
                return dict(items=items, next_room_id=rows[limit - 1][0] if len(rows) > limit else None)

    async def profile_summaries(self, users):
        if len(users) > 100:
            raise ValueError('Too many profile summaries.')
        async with self.pool.connection() as connection:
            rows = await (await connection.execute('''SELECT u.id,COALESCE(NULLIF(p.display_name,''),a.username),a.username
                FROM users u LEFT JOIN user_profiles p ON p.user_id=u.id
                LEFT JOIN account_credentials a ON a.user_id=u.id WHERE u.id=ANY(%s::uuid[])''',
                ([str(user_uuid(user)) for user in users],))).fetchall()
            profiles = {f'user-{r[0]}': dict(user_id=f'user-{r[0]}',display_name=r[1] or f'user-{r[0]}',username=r[2]) for r in rows}
            return [profiles[user] for user in users if user in profiles]

    @observe('read.members')
    async def members(self, room_id, actor, *, after_user_id=None, limit=100):
        if type(limit) is not int or not 1 <= limit <= 1000:
            raise ValueError('Invalid membership page limit.')
        after = user_uuid(after_user_id) if after_user_id else UUID(int=0)
        async with self.pool.connection() as connection:
            async with connection.transaction():
                await connection.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY')
                await require_member(connection, room_id, actor)
                rows = await (await connection.execute('''SELECT user_id FROM room_memberships
                    WHERE room_id=%s AND user_id>%s ORDER BY user_id LIMIT %s''', (room_id, after, limit + 1))).fetchall()
                return dict(items=[f'user-{r[0]}' for r in rows[:limit]],
                    next_user_id=f'user-{rows[limit - 1][0]}' if len(rows)>limit else None)

    @observe('read.room_invitations')
    async def room_invitations(self, actor, *, after_id='', limit=50):
        user_uuid(actor)
        if type(limit) is not int or not 1 <= limit <= 100:
            raise ValueError('Invalid invitation page limit.')
        async with self.pool.connection() as connection:
            rows = await (await connection.execute('''SELECT i.id,i.room_id,r.name,i.inviter_id FROM room_invitations i
                JOIN rooms r ON r.id=i.room_id WHERE i.recipient_id=%s AND i.status='pending' AND i.id>%s
                AND NOT EXISTS(SELECT 1 FROM deleted_rooms d WHERE d.id=r.id) ORDER BY i.id LIMIT %s''', (actor, after_id, limit + 1))).fetchall()
            return dict(items=[dict(id=r[0],room_id=r[1],room_name=r[2],inviter_id=r[3],recipient_id=actor,status='pending') for r in rows[:limit]],
                next_id=rows[limit - 1][0] if len(rows)>limit else None)

    @observe('read.invitations')
    async def invitations(self, actor, *, after_table_id=None, limit=50):
        """Bounded indexed recipient lookup; cursor advances over candidate tables.

        Invitations disclose public table metadata only. Membership is obtained by
        an explicit accepted command, never by reading the invitation list.
        """
        user_uuid(actor)
        if type(limit) is not int or not 1 <= limit <= 100:
            raise ValueError('Invalid invitation page limit.')
        after = UUID(str(after_table_id)) if after_table_id else UUID(int=0)
        from .room_commands import can_enter
        async with self.pool.connection() as connection:
            async with connection.transaction():
                await connection.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY')
                rows = await (await connection.execute('''SELECT r.table_id,r.revision,r.capacity,r.state,
                    t.status,rooms.id,rooms.creator_id,rooms.visibility,rooms.name FROM table_recovery_state r
                    JOIN room_tables t USING(table_id) JOIN rooms ON rooms.id=t.room_id
                    WHERE (r.state->'data'->'invitations') @> %s AND r.table_id>%s
                    AND NOT EXISTS (SELECT 1 FROM deleted_rooms WHERE id=rooms.id)
                    ORDER BY r.table_id LIMIT %s''', (Jsonb([dict(recipient_id=actor, status='pending')]), after, limit + 1))).fetchall()
                items = []
                for table, revision, capacity, state, status, room, owner, visibility, name in rows[:limit]:
                    if status == 'closed' or not await can_enter(connection, (room, owner, visibility), actor):
                        continue
                    seated = (await (await connection.execute('SELECT count(*) FROM table_positions WHERE table_id=%s AND seat IS NOT NULL', (table,))).fetchone())[0]
                    for item in state['data']['invitations']:
                        if item.get('recipient_id') == actor and item.get('status') == 'pending':
                            items.append(dict(item, table_id=table.hex, table_revision=revision, room_name=name,
                                capacity=capacity, seated=seated, seat_available=status == 'waiting'
                                and state['data']['host']['durable_game_id'] is None and seated < capacity))
                return dict(items=items, next_table_id=str(rows[limit - 1][0]) if len(rows) > limit else None)

    @observe('read.room')
    async def room(self, room_id, actor, *, table_id=None, match_id=None, select_default=False,
                   public_preview=False, invitation_preview=False):
        """Return bounded room previews and optionally one explicitly selected table.

        A closed table may be selected by its stable ID. Never fall back to some
        other match when the requested table is missing or belongs to another room.
        Raw recovery envelopes and other players' private projections never leave.
        """
        selected_id = UUID(str(table_id)) if table_id is not None else None
        if match_id is not None and table_id is not None:
            raise ValueError('Select a table or a match, not both.')
        selected_match = UUID(str(match_id)) if match_id is not None else None
        if (public_preview or invitation_preview) and (selected_id is not None or selected_match is not None or select_default):
            raise ValueError('Public previews cannot select private game snapshots.')
        async with self.pool.connection() as connection:
            async with connection.transaction():
                await connection.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY')
                if invitation_preview:
                    from .room_commands import can_enter
                    preview_room = await (await connection.execute('''SELECT id,creator_id,visibility FROM rooms
                        WHERE id=%s AND NOT EXISTS(SELECT 1 FROM deleted_rooms WHERE id=%s)''', (room_id, room_id))).fetchone()
                    if preview_room is None or not await can_enter(connection, preview_room, actor):
                        raise QueryAccessDenied('Room invitation is unavailable.')
                elif public_preview:
                    visible = await (await connection.execute('''SELECT 1 FROM rooms r WHERE r.id=%s
                        AND NOT EXISTS(SELECT 1 FROM deleted_rooms d WHERE d.id=r.id)
                        AND (r.visibility='public' OR r.creator_id=%s OR EXISTS
                            (SELECT 1 FROM room_memberships m WHERE m.room_id=r.id AND m.user_id=%s))''',
                        (room_id, user_uuid(actor), user_uuid(actor)))).fetchone()
                    if visible is None:
                        raise QueryAccessDenied('Room is not visible in this lobby.')
                else:
                    await require_member(connection, room_id, actor)
                if selected_match is not None:
                    selected = await (await connection.execute('''SELECT t.table_id FROM room_tables t
                        JOIN table_recovery_state s USING(table_id)
                        WHERE t.room_id=%s AND s.match_id=%s''', (room_id, selected_match))).fetchone()
                    if selected is None:
                        raise DurableGameNotFound('Match not found in this room.')
                    selected_id = selected[0]
                room = await (await connection.execute('SELECT name,creator_id,visibility,created_at FROM rooms WHERE id=%s', (room_id,))).fetchone()
                rows = await (await connection.execute('''SELECT table_id FROM room_tables
                    WHERE room_id=%s AND status<>'closed' ORDER BY created_at,table_id LIMIT %s''',
                    (room_id, self.max_tables + 1))).fetchall()
                if len(rows) > self.max_tables:
                    raise DurableGameConflict('Room exceeds the configured query table limit.')
                table_ids = [row[0] for row in rows]
                if selected_id is not None and selected_id not in table_ids:
                    row = await (await connection.execute('''SELECT table_id FROM room_tables
                        WHERE room_id=%s AND table_id=%s''', (room_id, selected_id))).fetchone()
                    if row is None:
                        raise DurableGameNotFound('Table not found in this room.')
                    table_ids.append(selected_id)
                host = _ProjectionHost(None, None, round_summary_seconds=self.round_summary_seconds)
                revisions, users = {}, {actor}
                for identifier in table_ids:
                    saved = await self.checkpoints.load_in_snapshot(connection, identifier)
                    rebuilt = rebuild_hosted_game(host, saved.checkpoint, receipt_snapshot=saved.receipt_snapshot)
                    game = rebuilt.game
                    host.tables.setdefault(room_id, {})[game.match_id] = game
                    revisions[game.table.table_id] = rebuilt.table_revision
                    users.update(game.users)
                    users.update(game.table.queue)
                    users.update(u for u in game.table.seats(game) if u is not None)
                names = await (await connection.execute('''SELECT u.id,COALESCE(NULLIF(p.display_name,''),a.username)
                    FROM users u LEFT JOIN user_profiles p ON p.user_id=u.id
                    LEFT JOIN account_credentials a ON a.user_id=u.id WHERE u.id=ANY(%s::uuid[])''',
                    ([str(user_uuid(u)) for u in sorted(users)],))).fetchall()
                host.profiles = _Profiles({f'user-{user}': name for user, name in names})
                result = dict(room_id=room_id, tables=host.table_previews(room_id, actor),
                    active_game=host.membership(room_id, actor), snapshot=None, name=room[0],
                    creator_id=f'user-{room[1]}', visibility=room[2], created_at=room[3].isoformat())
                if invitation_preview:
                    members = await (await connection.execute('''SELECT user_id FROM room_memberships
                        WHERE room_id=%s ORDER BY user_id LIMIT 1001''', (room_id,))).fetchall()
                    if len(members) > 1000:
                        raise DurableGameConflict('Room exceeds the lobby membership limit.')
                    result['members'] = [f'user-{m[0]}' for m in members]
                    result['created_at'] = room[3].timestamp()
                games = host._room_games(room_id)
                if selected_id is None and select_default:
                    game = next((g for g in games if actor in g.table.seats(g) and not g.ended), None)
                    game = game or next((g for g in reversed(games) if not g.ended), None)
                    if game is not None:
                        selected_id = UUID(game.table.table_id)
                for preview in result['tables']:
                    game = next(g for g in games if g.match_id == preview['match_id'])
                    preview.update(table_id=game.table.table_id, table_revision=revisions[game.table.table_id])
                if selected_id is not None:
                    game = next(g for g in games if UUID(g.table.table_id) == selected_id)
                    result['snapshot'] = host._snapshot(game, actor)
                    result['snapshot']['tables'] = deepcopy(result['tables'])
                    result['snapshot'].update(table_id=game.table.table_id,
                        table_revision=revisions[game.table.table_id],
                        durable_game_id=str(game.durable_game_id) if game.durable_game_id else None)
                # Detached objects are discarded; no close() hook with reservation
                # release or other mutation is appropriate for this read-only host.
                return deepcopy(result)

    async def game_view(self, room_id, actor, *, match_id=None):
        """Original game-screen read contract, without legacy read-time writes."""
        view = await self.room(room_id, actor, match_id=match_id, select_default=True)
        return view['snapshot'] or dict(room_id=room_id, status='empty', tables=view['tables'])

    async def member_profiles(self, room_id, actor, *, after_user_id=None, limit=100):
        if type(limit) is not int or not 1 <= limit <= 100:
            raise ValueError('Invalid member profile page limit.')
        after = user_uuid(after_user_id) if after_user_id else UUID(int=0)
        async with self.pool.connection() as connection:
            async with connection.transaction():
                await connection.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY')
                await require_member(connection, room_id, actor)
                rows = await (await connection.execute('''SELECT m.user_id,
                    COALESCE(NULLIF(p.display_name,''),a.username),a.username
                    FROM room_memberships m LEFT JOIN user_profiles p ON p.user_id=m.user_id
                    LEFT JOIN account_credentials a ON a.user_id=m.user_id
                    WHERE m.room_id=%s AND m.user_id>%s ORDER BY m.user_id LIMIT %s''',
                    (room_id, after, limit + 1))).fetchall()
                return dict(items=[dict(user_id=f'user-{r[0]}', display_name=r[1] or f'user-{r[0]}',
                                        username=r[2]) for r in rows[:limit]],
                    next_user_id=f'user-{rows[limit - 1][0]}' if len(rows) > limit else None)

    async def activity(self, actor, *, memberships=False, after_room_id='', limit=20):
        """Bounded room pages for original membership and active-table panels.

        Authorization is checked again within each projection snapshot, including
        when a room becomes private while this page is being assembled.
        """
        user = user_uuid(actor)
        if type(limit) is not int or not 1 <= limit <= 20:
            raise ValueError('Invalid activity page limit.')
        async with self.pool.connection() as connection:
            rows = await (await connection.execute('''SELECT r.id FROM rooms r WHERE r.id>%s
                AND NOT EXISTS(SELECT 1 FROM deleted_rooms d WHERE d.id=r.id)
                AND (EXISTS(SELECT 1 FROM room_memberships m WHERE m.room_id=r.id AND m.user_id=%s)
                     OR (%s=false AND (r.visibility='public' OR r.creator_id=%s)))
                ORDER BY r.id LIMIT %s''', (after_room_id, user, memberships, user, limit + 1))).fetchall()
        items = []
        for (room,) in rows[:limit]:
            try:
                view = await self.room(room, actor, public_preview=not memberships)
            except QueryAccessDenied:
                continue  # Room ceased to be visible; disclose no cached preview.
            if memberships:
                items.append(dict(room_id=room, tables=view['tables'], active_game=view['active_game']))
            else:
                items.extend(dict(table, room_id=room, room_name=view['name']) for table in view['tables'])
        return dict(items=items, next_room_id=rows[limit - 1][0] if len(rows) > limit else None)
