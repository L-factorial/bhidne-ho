"""Authenticated, read-only eligibility; final acceptance repeats these checks."""
from uuid import UUID


async def deletion_blockers(c, actor):
    uid = UUID(actor.removeprefix('user-'))
    items = []
    tables = await (await c.execute('''SELECT DISTINCT t.room_id,t.table_id,t.name,
        CASE WHEN r.state->'data'->'host'->'users'->>0=%s THEN 'end_table' ELSE 'leave_table' END
        FROM room_tables t LEFT JOIN table_recovery_state r USING(table_id)
        WHERE (t.status<>'closed' AND r.state->'data'->'host'->'users'->>0=%s)
        OR EXISTS(SELECT 1 FROM table_positions p WHERE p.table_id=t.table_id AND p.user_id=%s)
        OR EXISTS(SELECT 1 FROM active_table_players p WHERE p.table_id=t.table_id AND p.user_id=%s)
        OR EXISTS(SELECT 1 FROM game_connection_leases l WHERE l.table_id=t.table_id AND l.user_id=%s
            AND l.watching AND l.disconnected_at IS NULL AND l.expires_at>clock_timestamp())
        ORDER BY t.room_id,t.table_id LIMIT 101''', (actor,actor,uid,uid,uid))).fetchall()
    for room, table, name, action in tables:
        items.append(dict(kind=action, room_id=room, table_id=str(table), name=name))
    # Also cover legacy reservations/games which may not yet have normalized metadata.
    active = await (await c.execute('''SELECT
        EXISTS(SELECT 1 FROM active_game_players WHERE user_id=%s) OR
        EXISTS(SELECT 1 FROM active_table_players WHERE user_id=%s) OR
        EXISTS(SELECT 1 FROM table_positions WHERE user_id=%s)''', (uid,uid,uid))).fetchone()
    if active[0] and not tables:
        items.append(dict(kind='leave_table'))
    balances = await (await c.execute('''SELECT g.room_id,g.table_id FROM ledger_games g
        JOIN game_ledger_entries e USING(game_id) WHERE e.player_id=%s
        AND NOT EXISTS(SELECT 1 FROM settlement_games s WHERE s.game_id=g.game_id)
        GROUP BY g.room_id,g.table_id HAVING sum(e.amount)<>0
        UNION SELECT b.room_id,b.table_id FROM settlement_batches b JOIN settlement_transfers t USING(batch_id)
        WHERE (t.payer_id=%s OR t.payee_id=%s) AND t.status NOT IN ('RESOLVED','CANCELLED')
        ORDER BY room_id,table_id LIMIT 101''', (uid,uid,uid))).fetchall()
    for room, table in balances:
        items.append(dict(kind='settle_ledger',room_id=room,table_id=str(table)))
    pending = await (await c.execute('''SELECT
        EXISTS(SELECT 1 FROM command_inbox WHERE status='pending' AND (actor_id=%s OR payload::text LIKE %s)) OR
        EXISTS(SELECT 1 FROM table_recovery_state r WHERE r.phase IN ('OPEN','LOCKED','STARTED') AND r.state::text LIKE %s) OR
        EXISTS(SELECT 1 FROM game_finalization_jobs j JOIN games g ON g.id=j.game_id
            WHERE j.completed_at IS NULL AND (g.initial_state::text LIKE %s
            OR EXISTS(SELECT 1 FROM table_recovery_state r WHERE r.match_id=g.id AND r.state::text LIKE %s)
            OR EXISTS(SELECT 1 FROM hosted_match_archives a WHERE a.game_id=g.id AND a.checkpoint::text LIKE %s)))''',
        (actor,*(['%'+str(uid)+'%']*5)))).fetchone()
    if pending[0]:
        items.append(dict(kind='pending_actions'))
    room_ids=sorted({item['room_id'] for item in items if 'room_id' in item})
    if room_ids:
        rows=await (await c.execute('SELECT id,name FROM rooms WHERE id=ANY(%s)',(room_ids,))).fetchall()
        names=dict(rows)
        for item in items:
            if item.get('room_id') in names:item['room_name']=names[item['room_id']]
    return items


def blocker_code(items):
    if any(x['kind'] in ('leave_table','end_table') for x in items):
        return 'leave_games'
    if any(x['kind']=='settle_ledger' for x in items):
        return 'unsettled_ledger'
    return 'pending_actions'
