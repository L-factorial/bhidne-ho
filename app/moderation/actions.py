"""Explicit, idempotent enforcement, separate from report decisions."""
from datetime import timedelta
from uuid import uuid4
from app.durable_games.checkpoint_store import user_uuid
from app.durable_games.queries import QueryAccessDenied
from app.account_deletion.inventory import inspect_account
from .service import ReviewConflict

class ParticipationConflict(Exception): pass

class ModerationActions:
    def __init__(self, moderation):self.moderation=moderation;self.pool=moderation.pool

    async def apply(self, actor, report_id, action, reason, request_id, hours=24):
        async with self.pool.connection() as c:
            async with c.transaction():
                # Serialize policy changes before account rows. No gameplay lane
                # is mutated by moderation; removals use read-time tombstones.
                await c.execute('SELECT revision FROM social_policy_revision FOR UPDATE')
                await self.moderation.require(c,actor)
                prior=await (await c.execute('SELECT report_id,moderator_id,action,reason,id,hours FROM moderation_actions WHERE request_id=%s',(request_id,))).fetchone()
                if prior:
                    if prior[:4]!=(report_id,user_uuid(actor),action,reason) or prior[5]!=hours:raise ReviewConflict()
                    return dict(id=str(prior[4]),action=action)
                row=await (await c.execute('''SELECT r.reported_id,r.reporter_id,r.scope,r.message_id,d.decision FROM moderation_reports r
                    LEFT JOIN moderation_decisions d ON d.report_id=r.id WHERE r.id=%s AND r.expires_at>clock_timestamp() FOR UPDATE OF r''',(report_id,))).fetchone()
                if not row or row[4]!='accepted':raise QueryAccessDenied('An accepted report is required.')
                target,reporter,scope,message=row[:4]
                if user_uuid(actor) in (target,reporter):raise QueryAccessDenied('Another moderator must take this action.')
                available=await (await c.execute('SELECT id FROM users WHERE id=%s AND NOT deletion_pending AND NOT erased FOR UPDATE',(target,))).fetchone()
                if not available:raise QueryAccessDenied('Account unavailable.')
                until=None
                if action=='remove_message':
                    if scope=='player' or not message:raise ValueError('A message report is required.')
                    await c.execute('INSERT INTO removed_messages(scope,message_id) VALUES (%s,%s) ON CONFLICT DO NOTHING',(scope,message))
                elif action in ('mute','suspend'):
                    if action=='suspend':
                        inventory=await inspect_account(c,'user-'+str(target))
                        if inventory.active_games or inventory.reserved_tables or inventory.table_positions or inventory.pending_commands:
                            raise ParticipationConflict('Player must finish and leave active tables first. You can mute chat immediately.')
                    now=(await (await c.execute('SELECT clock_timestamp()')).fetchone())[0]
                    until=now+timedelta(hours=hours)
                    column='muted_until' if action=='mute' else 'suspended_until'
                    await c.execute(f'UPDATE users SET {column}=%s WHERE id=%s',(until,target))
                    if action=='suspend':await c.execute('DELETE FROM auth_sessions WHERE user_id=%s',(target,))
                elif action in ('unmute','unsuspend'):
                    column='muted_until' if action=='unmute' else 'suspended_until'
                    await c.execute(f'UPDATE users SET {column}=NULL WHERE id=%s',(target,))
                else:raise ValueError('Unknown moderation action.')
                identity=uuid4()
                await c.execute('''INSERT INTO moderation_actions(id,request_id,report_id,moderator_id,target_id,action,reason,until_at,hours)
                    VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)''',(identity,request_id,report_id,user_uuid(actor),target,action,reason,until,hours))
                await c.execute('UPDATE social_policy_revision SET revision=revision+1')
                return dict(id=str(identity),action=action)

    async def history(self,actor,target):
        async with self.pool.connection() as c:
            await self.moderation.require(c,actor)
            rows=await (await c.execute('''SELECT id,action,reason,moderator_id,created_at,until_at FROM moderation_actions
                WHERE target_id=%s ORDER BY created_at DESC LIMIT 100''',(user_uuid(target),))).fetchall()
        return dict(items=[dict(id=str(r[0]),action=r[1],reason=r[2],moderator_id='user-'+str(r[3]) if r[3] else None,
                               created_at=r[4].isoformat(),until_at=r[5].isoformat() if r[5] else None) for r in rows])
