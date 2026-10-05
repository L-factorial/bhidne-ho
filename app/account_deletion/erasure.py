"""Transactional erasure with explicit retained shared game-point references.

Does not claim anonymity: opponents can remember who played a historical seat.
No original identity-to-replacement mapping is retained after completion.
"""
import hashlib
import json
from uuid import uuid4

from psycopg import sql
from psycopg.types.json import Jsonb
from app.durable_games.checkpoints import canonical_json, RecoveryData
from app.durable_games.checkpoint_store import PostgresCheckpointStore

# Reviewed persisted replay/delivery sources. New sources must extend this list.
HISTORY = ('rooms','room_tables','table_recovery_state','games','game_commands','game_events',
           'game_snapshots','completed_games','hosted_match_archives','command_inbox',
           'scheduled_actions','notification_outbox','game_finalization_jobs','friend_notifications')
PERSONAL_FIELDS = {'text','message','display_name','username','email','name','phrase'}


class CleanupWaiting(Exception):
    pass


def rewrite(value, old, replacement, *, owned=False, names=()):
    if isinstance(value, list):
        return [rewrite(item, old, replacement, owned=owned, names=names) for item in value]
    if isinstance(value, dict):
        identities = [value[k] for k in ('user_id','actor_id','sender_id','player_id') if k in value]
        if identities:
            owned = any(identity in (old, 'user-'+old) for identity in identities)
        result = {}
        for key, item in value.items():
            new_key = key.replace('user-'+old,'user-'+replacement).replace(old,replacement)
            if owned and key in PERSONAL_FIELDS and isinstance(item,str):
                result[new_key] = 'Deleted player' if key in {'name','display_name','username'} else '[removed]'
            elif key in (old,'user-'+old) and isinstance(item,str) and item in names:
                result[new_key] = 'Deleted player'
            elif key in ('request_fingerprint', 'fingerprint', 'creation_fingerprint') and isinstance(item, str):
                try:
                    parsed = json.loads(item)
                except (ValueError, TypeError):
                    result[new_key] = rewrite(item,old,replacement,owned=owned,names=names)
                else:
                    result[new_key] = json.dumps(rewrite(parsed,old,replacement,owned=owned,names=names),sort_keys=True)
            else:
                result[new_key] = rewrite(item,old,replacement,owned=owned,names=names)
        if isinstance(result.get('request'), dict) and 'fingerprint' in result:
            result['fingerprint'] = json.dumps({k:v for k,v in result['request'].items() if k!='command_id'}, sort_keys=True)
        if 'digest' in result and isinstance(result.get('data'),dict):
            data = result['data']
            if 'positions' in data and 'engine' in data and 'host' in data:
                # JSONB normalizes 30.0 to 30; checkpoint signatures use the
                # typed schema's serialization, including float fields.
                data = RecoveryData.model_validate_json(canonical_json(data)).model_dump(mode='json')
            result['digest'] = hashlib.sha256(canonical_json(data).encode()).hexdigest()
        return result
    if isinstance(value,str):
        return value.replace('user-'+old,'user-'+replacement).replace(old,replacement)
    return value


async def erase(c, job, recovery):
    job_id, uid = job
    # Lock before account rows in the worker (same order as social login).
    await c.execute('UPDATE account_identity_generation SET generation=generation+1')
    old, replacement = str(uid), str(uuid4())
    actor = 'user-'+old
    # Fence the account's current and historical rooms before loading mutable data.
    room_rows = await (await c.execute('''SELECT DISTINCT room_id FROM (
        SELECT id AS room_id FROM rooms WHERE creator_id=%s
        UNION SELECT room_id FROM room_memberships WHERE user_id=%s
        UNION SELECT g.room_id FROM games g WHERE g.initial_state::text LIKE %s
        UNION SELECT t.room_id FROM table_recovery_state r JOIN room_tables t USING(table_id) WHERE r.state::text LIKE %s
        UNION SELECT t.room_id FROM hosted_match_archives a JOIN room_tables t USING(table_id) WHERE a.checkpoint::text LIKE %s
        UNION SELECT t.room_id FROM delivery_checkpoints d JOIN room_tables t USING(table_id) WHERE d.checkpoint::text LIKE %s
        UNION SELECT g.room_id FROM ledger_games g JOIN game_ledger_entries e USING(game_id) WHERE e.player_id=%s
        UNION SELECT b.room_id FROM settlement_batches b JOIN settlement_transfers t USING(batch_id) WHERE t.payer_id=%s OR t.payee_id=%s
        UNION SELECT g.room_id FROM game_events e JOIN games g ON g.id=e.game_id WHERE e.actor_id=%s
        ) affected ORDER BY room_id''', (uid,uid,'%'+old+'%','%'+old+'%','%'+old+'%','%'+old+'%',uid,uid,uid,actor))).fetchall()
    rooms = [r[0] for r in room_rows]
    for room in rooms:
        await c.execute('SELECT room_id FROM room_ownership WHERE room_id=%s FOR UPDATE', (room,))
    # Non-room social transactions serialize on lanes. No socket/SMTP call runs
    # while these locks are held. Live snapshots are transformed only after play.
    await c.execute('SELECT lane_id FROM command_lanes WHERE user_low=%s OR user_high=%s OR recipient_id=%s ORDER BY lane_id FOR UPDATE', (uid,uid,uid))
    live = await (await c.execute("SELECT 1 FROM table_recovery_state WHERE phase IN ('OPEN','LOCKED','STARTED') AND state::text LIKE %s LIMIT 1", ('%'+old+'%',))).fetchone()
    if live:
        raise CleanupWaiting('shared_game')
    queued = await (await c.execute("SELECT 1 FROM command_inbox WHERE status='pending' AND (actor_id=%s OR payload::text LIKE %s) LIMIT 1", (actor,'%'+old+'%'))).fetchone()
    if queued:
        raise CleanupWaiting('pending_actions')
    # Projection inputs are short-lived delivery work, not retained game history.
    # Removing the job fences an in-flight generator before it can reintroduce
    # erased identity. Existing delta rows become snapshot recovery markers.
    await c.execute('''DELETE FROM view_generation_jobs WHERE table_id IN (
        SELECT table_id FROM delivery_checkpoints WHERE checkpoint::text LIKE %s)''', ('%'+old+'%',))
    await c.execute('DELETE FROM delivery_checkpoints WHERE checkpoint::text LIKE %s', ('%'+old+'%',))
    await c.execute('''UPDATE notification_outbox SET event_type='VIEW_RESET',
        payload=jsonb_build_object('type','VIEW_RESET','table_id',payload->>'table_id')
        WHERE event_type='VIEW_DELTA' AND (payload::text LIKE %s OR lane_id IN (
            SELECT lane_id FROM command_lanes WHERE room_id=ANY(%s::text[])))''', ('%'+old+'%',rooms))
    # Recovery digests cover the assembled record, including SQL-backed engine
    # and positions. Do not sign just the partial table_recovery_state document.
    checkpoints = {}
    checkpoint_store = PostgresCheckpointStore(None)
    for room in rooms:
        for (table_id,) in await (await c.execute('SELECT table_id FROM room_tables WHERE room_id=%s', (room,))).fetchall():
            saved = await checkpoint_store._load(c, table_id, missing_ok=True)
            if saved and old in canonical_json(saved.checkpoint):
                checkpoints[table_id] = saved.checkpoint
    row = await (await c.execute('''SELECT c.username,c.unverified_email,r.email,p.display_name FROM users u
        LEFT JOIN account_credentials c ON c.user_id=u.id LEFT JOIN account_recovery_contacts r ON r.user_id=u.id
        LEFT JOIN user_profiles p ON p.user_id=u.id WHERE u.id=%s''', (uid,))).fetchone()
    names = tuple(x for x in (row[0],row[3]) if x)
    emails = {x for x in (row[1],row[2]) if x}
    # A deleted private conversation is removed for both participants, including
    # retained receipts. Room/table/game chat removes only this user's messages.
    lanes = [r[0] for r in await (await c.execute('SELECT lane_id FROM command_lanes WHERE user_low=%s OR user_high=%s OR recipient_id=%s', (uid,uid,uid))).fetchall()]
    for lane in lanes:
        for table in ('delivery_cursors','notification_outbox','friend_notifications','direct_messages','scheduled_actions','command_inbox'):
            await c.execute(sql.SQL('DELETE FROM {} WHERE lane_id=%s').format(sql.Identifier(table)).as_string(), (lane,))
        await c.execute('DELETE FROM command_lanes WHERE lane_id=%s', (lane,))
    await c.execute('DELETE FROM moderation_actions WHERE target_id=%s OR moderator_id=%s',(uid,uid))
    await c.execute('DELETE FROM community_acceptance WHERE user_id=%s',(uid,))
    await c.execute('DELETE FROM social_abuse_limits WHERE user_id=%s',(uid,))
    await c.execute('''DELETE FROM moderation_reports WHERE reporter_id=%s OR reported_id=%s
        OR id IN (SELECT report_id FROM moderation_decisions WHERE moderator_id=%s)''',(uid,uid,uid))
    await c.execute('DELETE FROM player_blocks WHERE blocker_id=%s OR blocked_id=%s',(uid,uid))
    for table, where, params in (
        ('room_chat_messages','sender_id=%s',(uid,)),
        ('direct_messages','sender_id=%s OR recipient_id=%s',(uid,uid)),
        ('friend_notifications','user_id=%s OR actor_id=%s OR source_actor_id=%s',(uid,uid,uid)),
        ('notification_outbox','audience_user_id=%s',(uid,)),
        ('delivery_cursors','user_id=%s',(uid,)),
        ('friendships','user_low=%s OR user_high=%s',(uid,uid)),
        ('push_devices','user_id=%s',(uid,)),
        ('push_preferences','user_id=%s',(uid,)),
        ('player_phrases','user_id=%s',(uid,)),
        ('hosted_invitation_limits','user_id=%s',(uid,)),
        ('room_invitations','inviter_id=%s OR recipient_id=%s',(actor,actor)),
    ):
        await c.execute(sql.SQL('DELETE FROM {} WHERE '+where).format(sql.Identifier(table)).as_string(),params)
    # Purge encrypted pending mailbox requests while keys are still available.
    for request_id,envelope in await (await c.execute('SELECT id,envelope FROM recovery_reset_requests FOR UPDATE')).fetchall():
        value = recovery.decrypt(envelope)
        if value.get('username') == row[0] or value.get('email') in emails:
            await c.execute('DELETE FROM recovery_reset_requests WHERE id=%s',(request_id,))
    identities = await (await c.execute('SELECT provider,provider_subject FROM external_identities WHERE user_id=%s', (uid,))).fetchall()
    for provider,subject in identities:
        await c.execute("DELETE FROM social_login_attempts WHERE provider=%s AND data->'identity'->>'subject'=%s",(provider,subject))
    for table in ('account_provider_grants','external_identities','auth_sessions','account_credentials'):
        await c.execute(sql.SQL('DELETE FROM {} WHERE user_id=%s').format(sql.Identifier(table)).as_string(),(uid,))
    # No absent account is required to confirm a future game-point transfer.
    # Ledger amounts remain intact; only its unfinished transfers are cancelled.
    batches = await (await c.execute("UPDATE settlement_transfers SET status='CANCELLED' WHERE (payer_id=%s OR payee_id=%s) AND status NOT IN ('RESOLVED','CANCELLED') RETURNING batch_id", (uid,uid))).fetchall()
    for (batch_id,) in batches:
        await c.execute("""UPDATE settlement_batches SET status=CASE
            WHEN NOT EXISTS(SELECT 1 FROM settlement_transfers WHERE batch_id=%s AND status NOT IN ('RESOLVED','CANCELLED')) THEN 'CANCELLED'
            ELSE 'PARTIALLY_RESOLVED' END WHERE batch_id=%s""", (batch_id,batch_id))
    # Transfer room management to the oldest remaining non-disabled member.
    await c.execute('''UPDATE rooms r SET creator_id=COALESCE((SELECT m.user_id FROM room_memberships m JOIN users u ON u.id=m.user_id
        WHERE m.room_id=r.id AND m.user_id<>%s AND NOT u.deletion_pending AND NOT u.erased ORDER BY m.joined_at,m.user_id LIMIT 1),r.creator_id)
        WHERE creator_id=%s''',(uid,uid))
    await c.execute('DELETE FROM room_memberships WHERE user_id=%s',(uid,))
    # Keep ledger values and replay structure, erase actor identity and authored
    # strings in all associated command/event/checkpoint/delivery copies.
    for table in HISTORY:
        columns = {r[0]:r[1] for r in await (await c.execute('SELECT column_name,data_type FROM information_schema.columns WHERE table_schema=current_schema() AND table_name=%s',(table,))).fetchall()}
        rows = await (await c.execute(sql.SQL('SELECT ctid::text,to_jsonb(t) FROM {} t WHERE to_jsonb(t)::text LIKE %s FOR UPDATE').format(sql.Identifier(table)).as_string(),('%'+old+'%',))).fetchall()
        for tid,data in rows:
            owned = data.get('actor_id')==actor or data.get('sender_id')==old
            changed = rewrite(data,old,replacement,owned=owned,names=names)
            # Relational IDs are moved by the final users PK cascade. Scope IDs
            # and primary identifiers remain untouched; actor_id is text.
            updates = {k:v for k,v in changed.items() if v!=data[k] and columns[k] in ('jsonb','text')}
            if 'original_request' in updates and updates['original_request'] is not None and 'request_fingerprint' in columns:
                updates['request_fingerprint'] = json.dumps({k:v for k,v in updates['original_request'].items() if k!='command_id'},sort_keys=True)
            if 'state' in updates and 'state_digest' in columns:
                updates['state_digest'] = hashlib.sha256(canonical_json(updates['state']).encode()).hexdigest()
            if updates:
                query = sql.SQL('UPDATE {} SET {} WHERE ctid=%s::tid').format(sql.Identifier(table),sql.SQL(',').join(sql.SQL('{}=%s').format(sql.Identifier(k)) for k in updates))
                await c.execute(query.as_string(),(*(Jsonb(v) if columns[k]=='jsonb' else v for k,v in updates.items()),tid))
    for table_id, checkpoint in checkpoints.items():
        changed = rewrite(checkpoint, old, replacement, names=names)
        await c.execute("UPDATE table_recovery_state SET state=jsonb_set(state,'{digest}',to_jsonb(%s::text)) WHERE table_id=%s", (changed['digest'],table_id))
    await c.execute("UPDATE user_profiles SET display_name='Deleted player',theme_family='heritage',theme_mode='system',updated_at=clock_timestamp() WHERE user_id=%s",(uid,))
    # Store no link back from completed job to the retained point-history identity.
    await c.execute('UPDATE users SET id=%s,erased=true,deletion_pending=true,created_at=clock_timestamp() WHERE id=%s',(replacement,uid))
    # Refuse the entire cleanup if transformed recovery data cannot be loaded.
    for table_id in checkpoints:
        await checkpoint_store._load(c, table_id)
    await c.execute('UPDATE account_deletion_jobs SET user_id=NULL WHERE id=%s',(job_id,))
    for room in rooms:
        await c.execute("UPDATE room_ownership SET ownership_epoch=ownership_epoch+1,owner_instance_id=NULL,fencing_token_hash=NULL,lease_expires_at=NULL,runtime_status='unowned' WHERE room_id=%s",(room,))
