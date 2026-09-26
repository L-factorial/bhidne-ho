"""Authorized sequenced social history and separately paged legacy records."""
from datetime import datetime
from uuid import UUID

from .checkpoint_store import user_uuid
from .delivery_store import bound, sequence
from .inbox import PostgresInboxStore, LaneTarget
from .social import authorize_social, conversation


class SocialHistory:
    def __init__(self, pool):
        self.pool, self.inbox = pool, PostgresInboxStore(pool)

    async def streams(self, actor, *, after=None, limit=50):
        """Authorized discovery for bootstrap, reconnect and new conversations."""
        bound(limit)
        user, boundary = user_uuid(actor), UUID(str(after)) if after else UUID(int=0)
        parts, params = [], []
        for role in ('user_low','user_high'):
            parts.append('''(SELECT lane_id,kind,user_low,user_high,emitted_sequence FROM command_lanes l
                WHERE kind='conversation' AND '''+role+'''=%s AND lane_id>%s
                AND EXISTS(SELECT 1 FROM friendships f WHERE f.user_low=l.user_low
                    AND f.user_high=l.user_high AND f.status='accepted') ORDER BY lane_id LIMIT %s)''')
            params.extend((user,boundary,limit+1))
        parts.append('''(SELECT lane_id,kind,user_low,user_high,emitted_sequence FROM command_lanes
            WHERE kind='recipient' AND recipient_id=%s AND lane_id>%s ORDER BY lane_id LIMIT %s)''')
        params.extend((user,boundary,limit+1,limit+1))
        async with self.pool.connection() as connection:
            rows = await (await connection.execute(' UNION ALL '.join(parts)+' ORDER BY lane_id LIMIT %s',params)).fetchall()
        return dict(items=[dict(lane_id=str(r[0]),kind=r[1],emitted_sequence=r[4],
            other_user_id=f'user-{r[3] if user==r[2] else r[2]}' if r[1]=='conversation' else None) for r in rows[:limit]],
            next_lane_id=str(rows[limit-1][0]) if len(rows)>limit else None)

    async def page(self, actor, lane_id, *, after=0, limit=100):
        sequence(after)
        bound(limit)
        lane_id = UUID(str(lane_id))
        async with self.pool.connection() as connection:
            async with connection.transaction():
                await connection.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY')
                target,_,_ = await self.inbox._lane(connection,lane_id)
                await authorize_social(connection,target,actor)
                if target.kind == 'conversation':
                    rows = await (await connection.execute('''SELECT id,sequence,sender_id,recipient_id,text,sent_at
                        FROM direct_messages WHERE lane_id=%s AND sequence>%s ORDER BY sequence LIMIT %s''',
                        (lane_id,after,limit+1))).fetchall()
                    items = [dict(id=str(r[0]),sequence=r[1],sender_id=f'user-{r[2]}',recipient_id=f'user-{r[3]}',
                                  text=r[4],sent_at=r[5].isoformat()) for r in rows[:limit]]
                else:
                    rows = await (await connection.execute('''SELECT id,sequence,kind,COALESCE(source_actor_id,actor_id),
                        payload,created_at,read_at FROM friend_notifications
                        WHERE lane_id=%s AND sequence>%s ORDER BY sequence LIMIT %s''', (lane_id,after,limit+1))).fetchall()
                    items = [dict(id=str(r[0]),sequence=r[1],kind=r[2],actor_id=f'user-{r[3]}' if r[3] else None,
                        payload=r[4],created_at=r[5].isoformat(),read=r[6] is not None) for r in rows[:limit]]
                return dict(source='sequenced',items=items,next_sequence=rows[limit-1][1] if len(rows)>limit else None)

    @staticmethod
    def _before(cursor):
        if cursor is None:
            return None
        if not isinstance(cursor,dict) or set(cursor) != {'at','id'}:
            raise ValueError('Invalid legacy history cursor.')
        at = datetime.fromisoformat(cursor['at'])
        if at.tzinfo is None:
            raise ValueError('Legacy cursor must include a timezone.')
        return at.isoformat(),UUID(cursor['id'])

    async def legacy_direct(self, actor, other, *, before=None, limit=100):
        bound(limit)
        target = conversation(actor,other)
        boundary = self._before(before)
        async with self.pool.connection() as connection:
            async with connection.transaction():
                await connection.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY')
                await authorize_social(connection,target,actor)
                # Bound each direction before merge, using the ordered legacy index.
                parts, params = [], []
                for sender,recipient in ((target.user_low,target.user_high),(target.user_high,target.user_low)):
                    where = ' AND (sent_at,id)<(%s::timestamptz,%s::uuid)' if boundary else ''
                    parts.append('''(SELECT id,sender_id,recipient_id,text,sent_at FROM direct_messages
                        WHERE lane_id IS NULL AND sender_id=%s AND recipient_id=%s''' + where +
                        ' ORDER BY sent_at DESC,id DESC LIMIT %s)')
                    params.extend((sender,recipient))
                    if boundary:
                        params.extend(boundary)
                    params.append(limit+1)
                rows = await (await connection.execute(' UNION ALL '.join(parts)+
                    ' ORDER BY sent_at DESC,id DESC LIMIT %s',(*params,limit+1))).fetchall()
                selected = rows[:limit]
                return dict(source='legacy',items=[dict(id=str(r[0]),sender_id=f'user-{r[1]}',recipient_id=f'user-{r[2]}',
                    text=r[3],sent_at=r[4].isoformat()) for r in reversed(selected)],
                    next_before=dict(at=selected[-1][4].isoformat(),id=str(selected[-1][0])) if len(rows)>limit else None)

    async def legacy_notifications(self, actor, *, before=None, limit=100):
        bound(limit)
        user, boundary = user_uuid(actor), self._before(before)
        async with self.pool.connection() as connection:
            async with connection.transaction():
                await connection.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY')
                await authorize_social(connection,LaneTarget(kind='recipient',recipient_id=user),actor)
                where = ' AND (created_at,id)<(%s::timestamptz,%s::uuid)' if boundary else ''
                params = [user,*(boundary or ()),limit+1]
                rows = await (await connection.execute('''SELECT id,kind,actor_id,payload,created_at,read_at
                    FROM friend_notifications WHERE user_id=%s AND lane_id IS NULL''' + where +
                    ' ORDER BY created_at DESC,id DESC LIMIT %s',params)).fetchall()
                selected = rows[:limit]
                return dict(source='legacy',items=[dict(id=str(r[0]),kind=r[1],actor_id=f'user-{r[2]}' if r[2] else None,
                    payload=r[3],created_at=r[4].isoformat(),read=r[5] is not None) for r in selected],
                    next_before=dict(at=selected[-1][4].isoformat(),id=str(selected[-1][0])) if len(rows)>limit else None)
