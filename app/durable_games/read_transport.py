"""Authorized view and stream bootstrap facade for the opt-in transport."""
from .chat import ChatHistory, authorize_chat
from .checkpoint_store import user_uuid
from .inbox import LaneTarget, PostgresInboxStore
from .queries import PostgresHostedQueries, QueryAccessDenied, require_member
from .social import authorize_social
from .social_history import SocialHistory
from .ledger_queries import PostgresLedgerQueries


class DistributedReads:
    def __init__(self, pool):
        self.pool = pool
        self.hosted = PostgresHostedQueries(pool)
        self.chat = ChatHistory(pool)
        self.social = SocialHistory(pool)
        self.ledger = PostgresLedgerQueries(pool)
        self.inbox = PostgresInboxStore(pool)

    async def open(self, actor, target):
        """Explicit POST: create an empty authorized lane, not game state/work."""
        target = LaneTarget.model_validate(target)
        async with self.pool.connection() as connection:
            async with connection.transaction():
                if target.kind in ('conversation', 'recipient'):
                    await authorize_social(connection, target, actor)
                else:
                    await require_member(connection, target.room_id, actor)
                    if target.table_id is not None:
                        row = await (await connection.execute('''SELECT 1 FROM room_tables
                            WHERE table_id=%s AND room_id=%s AND status<>'closed' ''',
                            (target.table_id, target.room_id))).fetchone()
                        if not row:
                            raise QueryAccessDenied('Table unavailable.')
                    if target.game_id is not None:
                        row = await (await connection.execute('''SELECT 1 FROM games
                            WHERE id=%s AND table_id=%s AND room_id=%s''',
                            (target.game_id, target.table_id, target.room_id))).fetchone()
                        if not row:
                            raise QueryAccessDenied('Game unavailable.')
                    if target.kind in ('room_chat', 'table_chat', 'game_chat'):
                        await authorize_chat(connection, target, actor, checkpoints=self.chat.checkpoints)
                lane = await self.inbox.ensure_lane_in_transaction(connection, target)
                return dict(lane_id=str(lane), target=target.model_dump(mode='json', exclude_none=True))

    async def recipient(self, actor):
        return await self.open(actor, LaneTarget(kind='recipient', recipient_id=user_uuid(actor)))
