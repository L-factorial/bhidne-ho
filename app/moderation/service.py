"""Bounded reports and immutable decisions; no gameplay or enforcement mutations."""
import asyncio
import logging
import os
from dataclasses import dataclass
from uuid import UUID, uuid4
from psycopg.types.json import Jsonb
from app.auth.email import normalize_recovery_email
from app.durable_games.checkpoint_store import user_uuid, PostgresCheckpointStore
from app.durable_games.queries import QueryAccessDenied
from app.durable_games.inbox import PostgresInboxStore
from app.durable_games.chat import authorize_chat


class ReportLimit(Exception): pass
class ReviewConflict(Exception): pass

@dataclass(frozen=True)
class ModeratorConfig:
    user_ids: frozenset = frozenset()
    emails: frozenset = frozenset()

    @classmethod
    def from_environment(cls):
        try:
            ids = frozenset(user_uuid(v.strip()) for v in os.getenv('BHIDNE_HO_MODERATOR_USER_IDS','').split(',') if v.strip())
            emails = frozenset(normalize_recovery_email(v.strip()) for v in os.getenv('BHIDNE_HO_MODERATOR_EMAILS','').split(',') if v.strip())
            return cls(ids, emails)
        except (ValueError, AttributeError):
            # Never echo secrets or partially enable an invalid allowlist.
            raise ValueError('Invalid moderator configuration; use account IDs and valid emails.') from None


class ModerationService:
    def __init__(self, pool, config=None):
        self.pool = pool
        self.config = config if config is not None else ModeratorConfig.from_environment()
        self.task = None

    async def permitted(self, c, actor):
        uid = user_uuid(actor)
        row = await (await c.execute('SELECT kind FROM users WHERE id=%s AND NOT deletion_pending AND NOT erased AND (suspended_until IS NULL OR suspended_until<=clock_timestamp())', (uid,))).fetchone()
        if not row or row[0] != 'account': return False
        if uid in self.config.user_ids: return True
        # Exact normalized mailbox, not unverified signup/provider claims. Ambiguous
        # mailboxes fail closed, including duplicates on deletion-pending accounts.
        row = await (await c.execute('''SELECT r.email FROM account_recovery_contacts r WHERE r.user_id=%s
            AND (SELECT count(*) FROM account_recovery_contacts x WHERE x.email=r.email)=1''', (uid,))).fetchone()
        return bool(row and row[0] in self.config.emails)

    async def require(self, c, actor):
        if not await self.permitted(c, actor): raise QueryAccessDenied('Moderator access required.')

    async def capabilities(self, actor):
        async with self.pool.connection() as c:
            return dict(reporting=True, moderator=await self.permitted(c, actor))

    async def submit(self, actor, target, scope, message_id, category, explanation):
        uid, other = user_uuid(actor), user_uuid(target)
        if uid == other: raise ValueError('Cannot report yourself.')
        async with self.pool.connection() as c:
            async with c.transaction():
                # Account row serializes report abuse limits across all gateways.
                rows = await (await c.execute('''SELECT id FROM users WHERE id=ANY(%s::uuid[])
                    AND NOT deletion_pending AND NOT erased ORDER BY id FOR UPDATE''', ([str(uid),str(other)],))).fetchall()
                if len(rows)!=2: raise QueryAccessDenied('Account unavailable.')
                row = await (await c.execute('''SELECT p.display_name,a.username FROM users u
                    LEFT JOIN user_profiles p ON p.user_id=u.id LEFT JOIN account_credentials a ON a.user_id=u.id
                    WHERE u.id=%s AND NOT u.deletion_pending AND NOT u.erased FOR SHARE OF u''',(other,))).fetchone()
                if not row: raise QueryAccessDenied('Player unavailable.')
                evidence = dict(display_name=row[0] or '', username=row[1])
                if scope == 'direct':
                    message = await (await c.execute('''SELECT text,sent_at FROM direct_messages
                        WHERE id=%s AND sender_id=%s AND recipient_id=%s''',(message_id,other,uid))).fetchone()
                    if not message: raise QueryAccessDenied('Message unavailable.')
                    evidence.update(text=message[0], sent_at=message[1].isoformat())
                elif scope == 'chat':
                    message = await (await c.execute('''SELECT text,sent_at,lane_id FROM room_chat_messages
                        WHERE id=%s AND sender_id=%s''',(message_id,other))).fetchone()
                    if not message or not message[2]: raise QueryAccessDenied('Message unavailable.')
                    lane,_,_ = await PostgresInboxStore(self.pool)._lane(c,message[2])
                    await authorize_chat(c,lane,actor,checkpoints=PostgresCheckpointStore(self.pool))
                    evidence.update(text=message[0],sent_at=message[1].isoformat(),context=lane.kind)
                duplicate = await (await c.execute('''SELECT id FROM moderation_reports WHERE reporter_id=%s AND reported_id=%s
                    AND scope=%s AND message_id IS NOT DISTINCT FROM %s::uuid AND category=%s
                    AND created_at>clock_timestamp()-interval '24 hours' ORDER BY created_at DESC LIMIT 1''',
                    (uid,other,scope,message_id,category))).fetchone()
                if duplicate: return dict(id=str(duplicate[0]))
                count = await (await c.execute("SELECT count(*) FROM moderation_reports WHERE reporter_id=%s AND created_at>clock_timestamp()-interval '1 hour'",(uid,))).fetchone()
                if count[0]>=10: raise ReportLimit()
                report = uuid4()
                await c.execute('''INSERT INTO moderation_reports(id,reporter_id,reported_id,scope,message_id,category,explanation,evidence)
                    VALUES (%s,%s,%s,%s,%s,%s,%s,%s)''',(report,uid,other,scope,message_id,category,explanation,Jsonb(evidence)))
                return dict(id=str(report))

    async def groups(self, actor, reviewed=False, after=None, limit=30):
        async with self.pool.connection() as c:
            async with c.transaction():
                await self.require(c,actor)
                rows = await (await c.execute('''SELECT r.reported_id,p.display_name,a.username,count(*),max(r.created_at)
                    FROM moderation_reports r LEFT JOIN moderation_decisions d ON d.report_id=r.id
                    LEFT JOIN user_profiles p ON p.user_id=r.reported_id LEFT JOIN account_credentials a ON a.user_id=r.reported_id
                    WHERE r.expires_at>clock_timestamp() AND (d.report_id IS NOT NULL)=%s AND r.reported_id>%s
                    GROUP BY r.reported_id,p.display_name,a.username ORDER BY r.reported_id LIMIT %s''',
                    (reviewed,UUID(after) if after else UUID(int=0),limit+1))).fetchall()
                return dict(items=[dict(user_id='user-'+str(r[0]),display_name=r[1] or '',username=r[2],count=r[3],latest=r[4].isoformat()) for r in rows[:limit]],
                    next_id=str(rows[limit-1][0]) if len(rows)>limit else None)

    async def reports(self, actor, target, reviewed=False, after=None, limit=30):
        async with self.pool.connection() as c:
            async with c.transaction():
                await self.require(c,actor)
                rows = await (await c.execute('''SELECT r.id,r.scope,r.category,r.explanation,r.evidence,r.created_at,
                    d.decision,d.reason,d.moderator_id,d.decided_at FROM moderation_reports r
                    LEFT JOIN moderation_decisions d ON d.report_id=r.id
                    WHERE r.reported_id=%s AND r.expires_at>clock_timestamp() AND (d.report_id IS NOT NULL)=%s AND r.id>%s
                    ORDER BY r.id LIMIT %s''',(user_uuid(target),reviewed,UUID(after) if after else UUID(int=0),limit+1))).fetchall()
                return dict(items=[dict(id=str(r[0]),scope=r[1],category=r[2],explanation=r[3],evidence=r[4],created_at=r[5].isoformat(),
                    decision=r[6],reason=r[7],moderator_id='user-'+str(r[8]) if r[8] else None,decided_at=r[9].isoformat() if r[9] else None) for r in rows[:limit]],
                    next_id=str(rows[limit-1][0]) if len(rows)>limit else None)

    async def decide(self, actor, report, decision, reason):
        async with self.pool.connection() as c:
            async with c.transaction():
                await self.require(c,actor)
                row = await (await c.execute('SELECT reporter_id,reported_id FROM moderation_reports WHERE id=%s AND expires_at>clock_timestamp() FOR UPDATE',(report,))).fetchone()
                if not row: raise QueryAccessDenied('Report unavailable.')
                if user_uuid(actor) in row: raise QueryAccessDenied('Another moderator must review this report.')
                prior = await (await c.execute('SELECT moderator_id,decision,reason FROM moderation_decisions WHERE report_id=%s',(report,))).fetchone()
                if prior:
                    if prior != (user_uuid(actor),decision,reason): raise ReviewConflict()
                else:
                    await c.execute('INSERT INTO moderation_decisions(report_id,moderator_id,decision,reason) VALUES (%s,%s,%s,%s)',(report,user_uuid(actor),decision,reason))
                return dict(decision=decision)

    async def purge(self):
        async with self.pool.connection() as c:
            await c.execute('DELETE FROM moderation_reports WHERE expires_at<=clock_timestamp()')
            await c.execute("DELETE FROM moderation_actions WHERE created_at<clock_timestamp()-interval '90 days'")
            await c.execute("DELETE FROM removed_messages r WHERE NOT EXISTS(SELECT 1 FROM notification_outbox o WHERE o.payload->>'id'=r.message_id::text AND o.event_type IN ('CHAT_MESSAGE','DIRECT_MESSAGE')) AND ((scope='chat' AND NOT EXISTS(SELECT 1 FROM room_chat_messages m WHERE m.id=r.message_id)) OR (scope='direct' AND NOT EXISTS(SELECT 1 FROM direct_messages m WHERE m.id=r.message_id)))")
            await c.execute("DELETE FROM social_abuse_limits WHERE window_at<clock_timestamp()-interval '2 days'")

    async def start(self):
        async def maintain():
            while True:
                try: await self.purge()
                except Exception: logging.getLogger(__name__).exception('Moderation retention cleanup failed')
                await asyncio.sleep(3600)
        if self.task is None: self.task=asyncio.create_task(maintain())

    async def stop(self):
        if self.task:
            self.task.cancel()
            try: await self.task
            except asyncio.CancelledError: pass
            self.task=None
