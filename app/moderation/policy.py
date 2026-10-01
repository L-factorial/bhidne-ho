"""Account-wide social policy. SQL locking makes counters shared across gateways."""
import hashlib
from datetime import timedelta
from app.durable_games.checkpoint_store import user_uuid
from app.durable_games.queries import QueryAccessDenied
from .content import normalized, validate_content

RULES_VERSION='2026-10-01'

async def require_posting(connection,actor, *, text=None, category='message', consume=False):
    uid=user_uuid(actor)
    # A policy update takes the exclusive counterpart before changing restrictions.
    await connection.execute('SELECT revision FROM social_policy_revision FOR SHARE')
    row=await (await connection.execute('''SELECT kind,muted_until>clock_timestamp() AS muted,suspended_until>clock_timestamp() AS suspended,
        EXISTS(SELECT 1 FROM community_acceptance WHERE user_id=u.id AND version=%s)
        FROM users u WHERE id=%s AND NOT deletion_pending AND NOT erased''',(RULES_VERSION,uid))).fetchone()
    if not row or row[0]!='account':raise QueryAccessDenied('Sign in with an account to post.')
    if row[2]:raise QueryAccessDenied('This account is suspended. Contact support to appeal.')
    if row[1]:raise QueryAccessDenied('Chat and invitations are temporarily muted. Contact support to appeal.')
    if not row[3]:raise QueryAccessDenied('Accept the community rules in Profile before posting.')
    if text is not None:
        try:validate_content(text)
        except ValueError as error:raise QueryAccessDenied(str(error)) from None
    if not consume:return
    await connection.execute('''INSERT INTO social_abuse_limits(user_id,category,window_at,count)
        VALUES (%s,%s,clock_timestamp(),0) ON CONFLICT DO NOTHING''',(uid,category))
    row=await (await connection.execute('''SELECT window_at,count,last_hash,last_at,clock_timestamp()
        FROM social_abuse_limits WHERE user_id=%s AND category=%s FOR UPDATE''',(uid,category))).fetchone()
    start,count,previous,last,now=row
    window=timedelta(minutes=1 if category=='message' else 60)
    maximum=20 if category=='message' else 20
    digest=hashlib.sha256(normalized(text).encode()).hexdigest() if text is not None else None
    if digest and digest==previous and last and now-last<timedelta(seconds=30):raise QueryAccessDenied('Please wait before repeating the same message.')
    if now-start>=window:start,count=now,0
    if count>=maximum:raise QueryAccessDenied('Too many messages or invitations. Please try again later.')
    await connection.execute('''UPDATE social_abuse_limits SET window_at=%s,count=%s,last_hash=%s,last_at=%s
        WHERE user_id=%s AND category=%s''',(start,count+1,digest,now,uid,category))

async def accept_rules(pool, actor, version):
    if version!=RULES_VERSION:raise ValueError('Review the latest community rules.')
    async with pool.connection() as c:
        await c.execute('''INSERT INTO community_acceptance(user_id,version) VALUES (%s,%s)
            ON CONFLICT(user_id) DO UPDATE SET version=EXCLUDED.version,accepted_at=clock_timestamp()''',(user_uuid(actor),version))

async def status(pool,actor):
    async with pool.connection() as c:
        row=await (await c.execute('''SELECT muted_until,suspended_until,
          EXISTS(SELECT 1 FROM community_acceptance WHERE user_id=u.id AND version=%s)
          FROM users u WHERE id=%s''',(RULES_VERSION,user_uuid(actor)))).fetchone()
    return dict(version=RULES_VERSION,accepted=bool(row and row[2]),muted_until=row[0].isoformat() if row and row[0] else None,
                suspended_until=row[1].isoformat() if row and row[1] else None)
