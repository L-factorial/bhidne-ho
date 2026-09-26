// Increment 1b checks, invoked by distributed-schema.cjs against its migration-13
// fixtures. Exercises SQL constraints, not the not-yet-implemented queue runtime.
const assert = require('node:assert/strict');
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;

module.exports = async function verifyInboxSchema(db, migration) {
  await db.exec(migration);
  const reject = (sql, params = [], code = '23514') => assert.rejects(
    db.query(sql, params), error => { assert.equal(error.code, code, error.message); return true; },
  );
  for (let n = 2; n <= 5; n++) {
    await db.query("INSERT INTO users (id,kind) VALUES ($1,'account')", [id(n)]);
  }
  assert.equal((await db.query('SELECT * FROM table_recovery_state')).rows.length, 0);
  const state = {
    historical_roster: [id(1), id(2)], departed: [id(2)],
    releases: { 2: id(2) },
    offers: [{ offer_id: id(301), match_id: id(103), seat: 2,
      offered_to: id(3), expires_at: '2026-09-24T12:01:00Z', status: 'PENDING' }],
    rule_proposal: { id: id(302), voters: [id(1), id(2)], accepted: [id(1)], status: 'PENDING' },
    invitations: [{ id: id(303), recipient: id(4), status: 'accepted' }],
    events: [{ sequence: 1, event: 'MATCH_COMPLETED' }], published_sequence: 1,
  };
  await db.query(`INSERT INTO table_recovery_state
    (table_id,match_id,schema_version,revision,phase,capacity,state)
    VALUES ($1,$2,1,7,'COMPLETED',4,$3)`, [id(10), id(103), JSON.stringify(state)]);
  const restored = (await db.query('SELECT * FROM table_recovery_state WHERE table_id=$1', [id(10)])).rows[0];
  assert.deepEqual(restored.state, state);
  assert.equal(Number(restored.revision), 7);
  await reject('UPDATE table_recovery_state SET schema_version=0 WHERE table_id=$1', [id(10)]);
  await reject("UPDATE table_recovery_state SET state='[]' WHERE table_id=$1", [id(10)]);

  // One current position per user/table; no duplicate seat or FIFO position.
  await db.query('INSERT INTO table_positions (table_id,user_id,seat) VALUES ($1,$2,1)', [id(10), id(1)]);
  await db.query(`INSERT INTO table_positions (table_id,user_id,queue_position)
    VALUES ($1,$2,20),($1,$3,10)`, [id(10), id(3), id(4)]);
  assert.deepEqual((await db.query(`SELECT user_id FROM table_positions
    WHERE table_id=$1 AND queue_position IS NOT NULL ORDER BY queue_position`, [id(10)])).rows.map(r => r.user_id), [id(4), id(3)]);
  await reject('INSERT INTO table_positions (table_id,user_id,seat) VALUES ($1,$2,1)', [id(10), id(2)], '23505');
  await reject('INSERT INTO table_positions (table_id,user_id,queue_position) VALUES ($1,$2,10)', [id(10), id(2)], '23505');
  await reject('INSERT INTO table_positions (table_id,user_id,queue_position) VALUES ($1,$2,30)', [id(10), id(1)], '23505');
  await reject('INSERT INTO table_positions (table_id,user_id,seat,queue_position) VALUES ($1,$2,2,30)', [id(10), id(2)]);
  await reject('INSERT INTO table_positions (table_id,user_id) VALUES ($1,$2)', [id(10), id(2)]);
  await reject('INSERT INTO table_positions (table_id,user_id,queue_position) VALUES ($1,$2,0)', [id(10), id(2)]);
  await reject('INSERT INTO table_positions (table_id,user_id,seat) VALUES ($1,$2,2)', [id(10), id(999)], '23503');
  // Recovery document and normalized positions can roll back as one unit.
  await db.exec('BEGIN');
  await db.query('UPDATE table_recovery_state SET revision=8 WHERE table_id=$1', [id(10)]);
  await db.query('UPDATE table_positions SET queue_position=NULL,seat=2 WHERE table_id=$1 AND user_id=$2', [id(10), id(4)]);
  await db.exec('ROLLBACK');
  assert.equal(Number((await db.query('SELECT revision FROM table_recovery_state WHERE table_id=$1', [id(10)])).rows[0].revision), 7);
  assert.equal(Number((await db.query('SELECT queue_position FROM table_positions WHERE table_id=$1 AND user_id=$2', [id(10), id(4)])).rows[0].queue_position), 10);

  const laneSql = `INSERT INTO command_lanes (lane_id,kind,room_id,table_id,game_id,user_low,user_high,recipient_id)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`;
  const targets = [
    ['game', 'room-a', id(10), id(103), null, null, null],
    ['game', 'room-a', id(11), id(102), null, null, null],
    ['table', 'room-a', id(10), null, null, null, null],
    ['room', 'room-a', null, null, null, null, null],
    ['room_chat', 'room-a', null, null, null, null, null],
    ['conversation', null, null, null, id(1), id(2), null],
    ['recipient', null, null, null, null, null, id(1)],
  ];
  for (const [offset, target] of targets.entries()) {
    await db.query(laneSql, [id(201 + offset), ...target]);
    await reject(laneSql, [id(220 + offset), ...target], '23505');
  }
  await reject(laneSql, [id(230), 'game', 'room-b', id(10), id(101), null, null, null], '23503');
  await reject(laneSql, [id(230), 'game', 'room-a', id(11), id(101), null, null, null], '23503');
  await reject(laneSql, [id(230), 'game', 'room-a', id(10), null, null, null, null]);
  await reject(laneSql, [id(230), 'conversation', null, null, null, id(2), id(1), null]);
  await reject(laneSql, [id(230), 'recipient', 'room-a', null, null, null, null, id(1)]);
  await reject('UPDATE command_lanes SET kind=$1 WHERE lane_id=$2', ['room_chat', id(204)]);
  await reject('UPDATE command_lanes SET processed_sequence=1 WHERE lane_id=$1', [id(201)]);

  const insert = `INSERT INTO command_inbox
    (lane_id,sequence,actor_id,command_id,command,match_id,expected_revision,payload,request_fingerprint)
    VALUES ($1,$2,$3,$4,'PLAY',$5,7,$6,$7)`;
  const enqueue = async (lane, command, actor = id(1), match = id(103)) => db.transaction(async tx => {
    const sequence = (await tx.query(`UPDATE command_lanes SET enqueued_sequence=enqueued_sequence+1
      WHERE lane_id=$1 RETURNING enqueued_sequence`, [lane])).rows[0].enqueued_sequence;
    const payload = JSON.stringify({ card: 'AS' });
    const fingerprint = JSON.stringify({ match_id: match, expected_revision: 7, command: 'PLAY', payload: { card: 'AS' } });
    await tx.query(insert, [lane, sequence, actor, command, match, payload, fingerprint]);
    return Number(sequence);
  });
  assert.equal(await enqueue(id(201), 'first'), 1);
  assert.equal(await enqueue(id(201), 'second'), 2);
  assert.equal(await enqueue(id(202), 'first', id(1), id(102)), 1); // Independent game sequence.
  assert.equal(await enqueue(id(201), 'first', id(2)), 3); // IDs are actor-scoped.
  await assert.rejects(enqueue(id(201), 'first'), e => e.code === '23505');
  assert.equal(Number((await db.query('SELECT enqueued_sequence FROM command_lanes WHERE lane_id=$1', [id(201)])).rows[0].enqueued_sequence), 3);
  await reject(insert, [id(201), 4, id(1), 'wrong-match', id(102), '{}', 'original']);
  await reject(insert, [id(201), 4, id(1), 'bad id', id(103), '{}', 'original']);
  await reject(insert, [id(201), 4, id(1), 'bad-payload', id(103), '[]', 'original']);
  await reject(insert.replace("'PLAY',$5,7", "'PLAY',$5,NULL"), [id(201), 4, id(1), 'no-revision', id(103), '{}', 'original']);
  await reject('UPDATE command_inbox SET payload=$1 WHERE lane_id=$2 AND sequence=1', ['{"card":"KS"}', id(201)]);
  await reject('UPDATE command_inbox SET expected_revision=8 WHERE lane_id=$1 AND sequence=1', [id(201)]);
  await reject("UPDATE command_inbox SET status='accepted' WHERE lane_id=$1 AND sequence=1", [id(201)]);

  await db.transaction(async tx => {
    await tx.query(`UPDATE command_inbox SET status='accepted',outcome='{"revision":8}',completed_at=now()
      WHERE lane_id=$1 AND sequence=1`, [id(201)]);
    await tx.query('UPDATE command_lanes SET processed_sequence=1 WHERE lane_id=$1', [id(201)]);
  });
  await reject("UPDATE command_inbox SET status='pending',outcome=NULL,completed_at=NULL WHERE lane_id=$1 AND sequence=1", [id(201)]);
  await reject("UPDATE command_inbox SET outcome='{}' WHERE lane_id=$1 AND sequence=1", [id(201)]);
  await reject('UPDATE command_lanes SET processed_sequence=0 WHERE lane_id=$1', [id(201)]);
  await reject('UPDATE command_lanes SET enqueued_sequence=2 WHERE lane_id=$1', [id(201)]);
  assert.deepEqual((await db.query(`SELECT sequence FROM command_inbox WHERE lane_id=$1 AND status='pending'
    ORDER BY sequence`, [id(201)])).rows.map(r => Number(r.sequence)), [2, 3]);

  // Generic room commands have no required game revision or match.
  await db.query(`INSERT INTO command_inbox
    (lane_id,sequence,actor_id,command_id,command,payload,request_fingerprint)
    VALUES ($1,1,'system:room','create-table','CREATE_TABLE','{}','original')`, [id(204)]);
  await db.query(`UPDATE command_inbox SET status='rejected',outcome='{"code":"ROOM_FULL"}',completed_at=now()
    WHERE lane_id=$1`, [id(204)]);
  await reject("UPDATE command_inbox SET status='accepted' WHERE lane_id=$1", [id(204)]);
  // Receipts remain addressable on a completed game; a rematch uses another lane.
  await db.query("UPDATE games SET status='completed',completed_at=now() WHERE id=$1", [id(103)]);
  assert.deepEqual((await db.query(`SELECT outcome FROM command_inbox
    WHERE lane_id=$1 AND actor_id=$2 AND command_id='first'`, [id(201), id(1)])).rows[0].outcome, { revision: 8 });
  await db.query(`INSERT INTO games (id,room_id,table_id,game_type,engine_version,event_schema_version,initial_state,status)
    VALUES ($1,'room-a',$2,'callbreak',1,1,'{}','active')`, [id(105), id(10)]);
  await db.query(laneSql, [id(231), 'game', 'room-a', id(10), id(105), null, null, null]);
  assert.equal(await enqueue(id(231), 'first', id(1), id(105)), 1);
  console.log('PASS: recovery positions, lane isolation, ordered allocation rollback, deduplication constraints, immutable requests/outcomes, rematch isolation');
};
