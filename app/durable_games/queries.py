"""Authorized committed projections, usable on any server without an owner host.

These explicit adapters are not installed in the legacy HTTP/WS composition.
Authorization and projection share one read-only PostgreSQL snapshot. Departure
committed before that snapshot denies access; a concurrent departure may finish
after it. No timers, settlements, ownership, or durable state advance on a read.
"""
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

    async def room(self, room_id, actor, *, table_id=None):
        """Return bounded room previews and optionally one explicitly selected table.

        A closed table may be selected by its stable ID. Never fall back to some
        other match when the requested table is missing or belongs to another room.
        Raw recovery envelopes and other players' private projections never leave.
        """
        selected_id = UUID(str(table_id)) if table_id is not None else None
        async with self.pool.connection() as connection:
            async with connection.transaction():
                await connection.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY')
                await require_member(connection, room_id, actor)
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
                games = host._room_games(room_id)
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
