// Increment 1c SQL checks; invoked after the 1b fixtures by distributed-schema.cjs.
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;

module.exports = async function verifyDeliverySchema(db, migration) {
  const reject = (sql, params = [], code = '23514') => assert.rejects(
    db.query(sql, params), error => { assert.equal(error.code, code, error.message); return true; },
  );
  const legacyMessage = `INSERT INTO direct_messages (id,sender_id,recipient_id,text)
    VALUES ($1,$2,$3,'Legacy message')`;
  const legacyNotice = `INSERT INTO friend_notifications (id,user_id,actor_id,kind)
    VALUES ($1,$2,$3,'friend_accepted')`;
  await db.query(legacyMessage, [id(400), id(1), id(2)]);
  await db.query(legacyNotice, [id(401), id(1), id(2)]);
  await db.exec(migration);
  // Both existing rows and old insert contracts survive the upgrade.
  await db.query(legacyMessage, [id(402), id(1), id(2)]);
  await db.query(legacyNotice, [id(403), id(1), id(2)]);
  assert.equal((await db.query('SELECT lane_id FROM direct_messages WHERE id=$1', [id(400)])).rows[0].lane_id, null);
  assert.deepEqual((await db.query('SELECT payload FROM friend_notifications WHERE id=$1', [id(401)])).rows[0].payload, {});

  const snapshot = `INSERT INTO game_snapshots
    (game_id,sequence,revision,engine_version,event_schema_version,snapshot_schema_version,state,state_digest)
    VALUES ($1,$2,$3,1,1,1,$4,$5)`;
  const checkpoint = JSON.stringify({ revision: 0, value: { phase: 'waiting' } });
  const digest = createHash('sha256').update(checkpoint).digest('hex');
  await db.query(snapshot, [id(105), 0, 0, checkpoint, digest]);
  assert.deepEqual((await db.query('SELECT state FROM game_snapshots WHERE game_id=$1', [id(105)])).rows[0].state, JSON.parse(checkpoint));
  await reject(snapshot, [id(105), 0, 0, checkpoint, digest], '23505');
  await reject(snapshot, [id(105), 1, 0, checkpoint, digest]);
  await reject(snapshot, [id(105), 0, 1, checkpoint, digest]);
  await reject(snapshot.replace('1,1,1,$4', '2,1,1,$4'), [id(105), 0, 0, checkpoint, digest]);
  await reject('UPDATE game_snapshots SET state=$1 WHERE game_id=$2', ['{}', id(105)]);

  const timer = `INSERT INTO scheduled_actions
    (action_id,lane_id,action_type,generation,due_at,command_id,command,match_id,expected_revision,payload)
    VALUES ($1,$2,'turn_timeout',$3,'2026-09-24T12:00:00Z',$4,'TIMEOUT',$5,0,'{}')`;
  await db.query(timer, [id(410), id(231), 1, 'timeout-1', id(105)]);
  await reject(timer, [id(411), id(231), 1, 'timeout-duplicate', id(105)], '23505');
  await reject(timer, [id(411), id(231), 2, 'timeout-2', id(103)]);
  await reject("UPDATE scheduled_actions SET due_at=due_at+interval '30 seconds' WHERE action_id=$1", [id(410)]);
  // A player's unrelated command cannot be mistaken for the timer's dispatch.
  await reject(`UPDATE scheduled_actions SET status='enqueued',inbox_sequence=1,finished_at=now()
    WHERE action_id=$1`, [id(410)]);
  await db.exec('BEGIN');
  await db.query('UPDATE command_lanes SET enqueued_sequence=2 WHERE lane_id=$1', [id(231)]);
  await db.query(`INSERT INTO command_inbox
    (lane_id,sequence,actor_id,command_id,command,match_id,expected_revision,payload,request_fingerprint)
    VALUES ($1,2,'system:timer','timeout-1','TIMEOUT',$2,0,'{}','timer-original')`, [id(231), id(105)]);
  await db.query(`UPDATE scheduled_actions SET status='enqueued',inbox_sequence=2,finished_at=now()
    WHERE action_id=$1`, [id(410)]);
  await db.exec('ROLLBACK');
  assert.equal((await db.query('SELECT status FROM scheduled_actions WHERE action_id=$1', [id(410)])).rows[0].status, 'pending');
  assert.equal((await db.query('SELECT * FROM command_inbox WHERE lane_id=$1 AND sequence=2', [id(231)])).rows.length, 0);
  await db.transaction(async tx => {
    await tx.query('UPDATE command_lanes SET enqueued_sequence=2 WHERE lane_id=$1', [id(231)]);
    await tx.query(`INSERT INTO command_inbox
      (lane_id,sequence,actor_id,command_id,command,match_id,expected_revision,payload,request_fingerprint)
      VALUES ($1,2,'system:timer','timeout-1','TIMEOUT',$2,0,'{}','timer-original')`, [id(231), id(105)]);
    await tx.query(`UPDATE scheduled_actions SET status='enqueued',inbox_sequence=2,finished_at=now()
      WHERE action_id=$1`, [id(410)]);
  });
  await reject("UPDATE scheduled_actions SET status='pending',inbox_sequence=NULL,finished_at=NULL WHERE action_id=$1", [id(410)]);
  await db.query(timer, [id(411), id(231), 2, 'timeout-2', id(105)]);
  await db.query("UPDATE scheduled_actions SET status='cancelled',finished_at=now() WHERE action_id=$1", [id(411)]);
  assert.equal((await db.query("SELECT * FROM scheduled_actions WHERE status='pending'")).rows.length, 0);

  const publish = `INSERT INTO notification_outbox (event_id,lane_id,sequence,event_type,payload)
    VALUES ($1,$2,$3,'STATE_CHANGED','{"revision":1}')`;
  await reject(publish, [id(420), id(231), 1]); // Cannot emit beyond allocated cursor.
  await db.exec('BEGIN');
  await db.query('UPDATE command_lanes SET emitted_sequence=1 WHERE lane_id=$1', [id(231)]);
  await db.query(publish, [id(420), id(231), 1]);
  await db.exec('ROLLBACK');
  assert.equal((await db.query('SELECT * FROM notification_outbox')).rows.length, 0);
  assert.equal(Number((await db.query('SELECT emitted_sequence FROM command_lanes WHERE lane_id=$1', [id(231)])).rows[0].emitted_sequence), 0);
  await db.query('UPDATE command_lanes SET emitted_sequence=3 WHERE lane_id=$1', [id(231)]);
  await db.query(publish, [id(420), id(231), 1]);
  await db.query(publish, [id(421), id(231), 2]);
  await reject(publish, [id(422), id(231), 1], '23505');
  await reject('UPDATE command_lanes SET emitted_sequence=1 WHERE lane_id=$1', [id(231)]);
  await reject('UPDATE notification_outbox SET payload=$1 WHERE event_id=$2', ['{}', id(420)]);
  await reject('UPDATE notification_outbox SET claim_token=$1 WHERE event_id=$2', [id(499), id(420)]);
  await db.query(`UPDATE notification_outbox SET attempts=1,claim_token=$1,
    claim_expires_at=now()+interval '10 seconds' WHERE event_id=$2`, [id(499), id(420)]);
  await reject('UPDATE notification_outbox SET published_at=now() WHERE event_id=$1', [id(420)]);
  await db.query(`UPDATE notification_outbox SET published_at=now(),claim_token=NULL,claim_expires_at=NULL
    WHERE event_id=$1`, [id(420)]);
  await reject('UPDATE notification_outbox SET published_at=NULL WHERE event_id=$1', [id(420)]);
  assert.deepEqual((await db.query('SELECT event_id FROM notification_outbox WHERE published_at IS NULL')).rows.map(r => r.event_id), [id(421)]);

  // Per-device progress is independent of the other devices and publication.
  const cursor = `INSERT INTO delivery_cursors (user_id,client_id,lane_id,last_sequence) VALUES ($1,$2,$3,$4)`;
  await db.query(cursor, [id(1), 'phone', id(231), 2]);
  await db.query(cursor, [id(1), 'browser', id(231), 0]);
  await reject(cursor, [id(2), 'phone', id(231), 4]);
  await reject("UPDATE delivery_cursors SET last_sequence=1 WHERE client_id='phone' AND lane_id=$1", [id(231)]);
  assert.equal(Number((await db.query("SELECT last_sequence FROM delivery_cursors WHERE client_id='browser' AND lane_id=$1", [id(231)])).rows[0].last_sequence), 0);

  await db.query('UPDATE command_lanes SET emitted_sequence=4 WHERE lane_id IN ($1,$2,$3)', [id(205), id(206), id(207)]);
  const roomMessage = `INSERT INTO room_chat_messages (id,room_id,sender_id,lane_id,sequence,command_id,text)
    VALUES ($1,$2,$3,$4,$5,$6,'Room hello')`;
  await db.query(roomMessage, [id(430), 'room-a', id(1), id(205), 1, 'room-chat-1']);
  await reject(roomMessage, [id(431), 'room-a', id(1), id(205), 2, 'room-chat-1'], '23505');
  await reject(roomMessage, [id(431), 'room-b', id(1), id(205), 2, 'room-chat-2']);
  await reject(roomMessage, [id(431), 'room-a', id(1), id(204), 1, 'room-chat-2']);
  await reject('UPDATE room_chat_messages SET text=$1 WHERE id=$2', ['Changed', id(430)]);

  const dm = `INSERT INTO direct_messages (id,sender_id,recipient_id,text,lane_id,sequence,command_id)
    VALUES ($1,$2,$3,'Private hello',$4,$5,$6)`;
  await db.query(dm, [id(440), id(1), id(2), id(206), 1, 'dm-1']);
  await db.query(dm, [id(441), id(2), id(1), id(206), 2, 'dm-1']);
  await reject(dm, [id(442), id(1), id(2), id(206), 3, 'dm-1'], '23505');
  await reject(dm, [id(442), id(1), id(3), id(206), 3, 'dm-2']);
  await reject(dm, [id(442), id(1), id(2), null, 3, 'dm-2']);
  await reject('UPDATE direct_messages SET lane_id=NULL,sequence=NULL,command_id=NULL WHERE id=$1', [id(440)]);
  await reject(cursor, [id(3), 'phone', id(206), 0]);
  assert.deepEqual((await db.query('SELECT id FROM direct_messages WHERE lane_id=$1 AND sequence>0 ORDER BY sequence', [id(206)])).rows.map(r => r.id), [id(440), id(441)]);

  const notice = `INSERT INTO friend_notifications
    (id,user_id,kind,lane_id,sequence,deduplication_key,payload)
    VALUES ($1,$2,'game_completed',$3,$4,$5,'{"game_id":"completed"}')`;
  await db.query(notice, [id(450), id(1), id(207), 1, 'game-completed:103']);
  await reject(notice, [id(451), id(1), id(207), 2, 'game-completed:103'], '23505');
  await reject(notice, [id(451), id(2), id(207), 2, 'game-completed:104']);
  await db.query('UPDATE friend_notifications SET read_at=now() WHERE id=$1', [id(450)]);
  await reject('UPDATE friend_notifications SET payload=$1 WHERE id=$2', ['{}', id(450)]);
  await reject(cursor, [id(2), 'phone', id(207), 0]);
  await reject(`INSERT INTO notification_outbox
    (event_id,lane_id,sequence,event_type,audience_user_id,payload) VALUES ($1,$2,1,'PRIVATE',$3,'{}')`, [id(460), id(207), id(2)]);

  const job = `INSERT INTO game_finalization_jobs (job_id,game_id,round_number,job_type,payload)
    VALUES ($1,$2,$3,'ledger',$4)`;
  await db.query(job, [id(470), id(103), 0, JSON.stringify({ ledger_game_id: id(103) })]);
  await reject(job, [id(471), id(103), 0, '{}'], '23505');
  await db.query(job, [id(472), id(103), 1, JSON.stringify({ ledger_game_id: id(473) })]);
  await reject('UPDATE game_finalization_jobs SET payload=$1 WHERE job_id=$2', ['{}', id(470)]);
  await db.query('UPDATE game_finalization_jobs SET attempts=1,last_error=$1 WHERE job_id=$2', ['temporary failure', id(470)]);
  await reject('UPDATE game_finalization_jobs SET attempts=0 WHERE job_id=$1', [id(470)]);
  await db.query('UPDATE game_finalization_jobs SET completed_at=now() WHERE job_id=$1', [id(470)]);
  await reject('UPDATE game_finalization_jobs SET completed_at=NULL WHERE job_id=$1', [id(470)]);
  assert.deepEqual((await db.query('SELECT job_id FROM game_finalization_jobs WHERE completed_at IS NULL')).rows.map(r => r.job_id), [id(472)]);
  console.log('PASS: checkpoints, timer dispatch rollback, outbox retry state, per-device catch-up, legacy messaging, private targets, finalization deduplication');
};
