// Execute the actual migrations in PostgreSQL/WASM without an application DB.
// PGLITE_MODULE=/path/to/@electric-sql/pglite node tests/distributed-schema.cjs
const { PGlite } = require(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const { spawnSync } = require('node:child_process');
const { join } = require('node:path');
const assert = require('node:assert/strict');
const root = join(__dirname, '..');
const exported = spawnSync(process.env.PYTHON || join(root, '.venv/bin/python'), [
  '-c', 'import json; from app.database import MIGRATIONS; print(json.dumps(MIGRATIONS))',
], { cwd: root, encoding: 'utf8' });
assert.equal(exported.status, 0, exported.stderr);
const migrations = JSON.parse(exported.stdout);
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;

async function rejected(db, sql, params, code, constraint) {
  await assert.rejects(db.query(sql, params), error => {
    assert.equal(error.code, code, error.message);
    if (constraint) assert.equal(error.constraint, constraint);
    return true;
  });
}

async function insertGame(db, number, table = null, room = 'room-a') {
  return db.query(`INSERT INTO games
    (id,room_id,table_id,game_type,engine_version,event_schema_version,initial_state,status)
    VALUES ($1,$2,$3,'callbreak',1,1,'{}','active')`, [id(number), room, table]);
}

async function verify(upgrade) {
  const db = new PGlite();
  try {
    for (const [version, sql] of migrations) {
      if (version <= 12) await db.exec(sql);
    }
    // Upgrade an installed database with real records as well as testing an
    // empty installation. The new migration must not invent legacy table IDs.
    await db.query("INSERT INTO users (id,kind) VALUES ($1,'account')", [id(1)]);
    await db.query(`INSERT INTO rooms (id,creator_id,name,visibility) VALUES
      ('room-a',$1,'First room','private'), ('room-b',$1,'Second room','private')`, [id(1)]);
    if (upgrade) {
      await db.query(`INSERT INTO games
        (id,room_id,game_type,engine_version,event_schema_version,initial_state,status)
        VALUES ($1,'room-a','callbreak',1,1,'{"legacy":true}','active')`, [id(100)]);
    }
    await db.exec(migrations.find(([version]) => version === 13)[1]);
    if (upgrade) {
      const legacy = (await db.query('SELECT table_id,initial_state FROM games WHERE id=$1', [id(100)])).rows[0];
      assert.equal(legacy.table_id, null);
      assert.deepEqual(legacy.initial_state, { legacy: true });
    }

    const insertTable = (number, room = 'room-a') => db.query(`INSERT INTO room_tables
      (table_id,room_id,name,game_type) VALUES ($1,$2,'Table','callbreak')`, [id(number), room]);
    const count = async () => Number((await db.query(
      "SELECT open_table_count FROM rooms WHERE id='room-a'",
    )).rows[0].open_table_count);

    for (let n = 10; n < 15; n++) await insertTable(n);
    assert.equal(await count(), 5);
    await rejected(db, `INSERT INTO room_tables (table_id,room_id,name,game_type)
      VALUES ($1,'room-a','Sixth','callbreak')`, [id(15)], '23514', 'room_open_table_limit');
    assert.equal(await count(), 5);
    assert.equal((await db.query('SELECT table_id FROM room_tables WHERE table_id=$1', [id(15)])).rows.length, 0);
    await insertTable(20, 'room-b'); // Capacity is per room.

    // Idempotent insertion and ordinary edits must not consume extra capacity.
    await db.query(`INSERT INTO room_tables (table_id,room_id,name,game_type)
      VALUES ($1,'room-a','Retry','callbreak') ON CONFLICT (table_id) DO NOTHING`, [id(10)]);
    await db.query("UPDATE room_tables SET status='playing', name='Renamed' WHERE table_id=$1", [id(10)]);
    assert.equal(await count(), 5);
    await rejected(db, "UPDATE rooms SET max_open_tables=4 WHERE id='room-a'", [], '23514', 'room_open_table_limit');

    await db.query("UPDATE room_tables SET status='closed',closed_at=now() WHERE table_id=$1", [id(10)]);
    assert.equal(await count(), 4);
    await insertTable(15);
    await rejected(db, "UPDATE room_tables SET status='waiting',closed_at=NULL WHERE table_id=$1",
      [id(10)], '23514', 'room_open_table_limit');
    await db.query('DELETE FROM room_tables WHERE table_id=$1', [id(15)]);
    assert.equal(await count(), 4);
    await db.query("UPDATE room_tables SET status='waiting',closed_at=NULL WHERE table_id=$1", [id(10)]);
    assert.equal(await count(), 5);
    await rejected(db, "UPDATE room_tables SET room_id='room-b' WHERE table_id=$1", [id(10)], '23514');
    assert.equal(await count(), 5);

    // Allocation and its counter roll back together, including a multirow error.
    await db.exec('BEGIN');
    await db.query('DELETE FROM room_tables WHERE table_id=$1', [id(14)]);
    assert.equal(await count(), 4);
    await db.exec('ROLLBACK');
    assert.equal(await count(), 5);
    await db.exec("UPDATE rooms SET max_open_tables=6 WHERE id='room-a'");
    await rejected(db, `INSERT INTO room_tables (table_id,room_id,name,game_type) VALUES
      ($1,'room-a','Sixth','flush'), ($2,'room-a','Seventh','marriage')`,
      [id(15), id(16)], '23514', 'room_open_table_limit');
    assert.equal(await count(), 5);
    await insertTable(15);
    assert.equal(await count(), 6);

    await insertGame(db, 101, id(10));
    await insertGame(db, 102, id(11)); // Independent tables can run games.
    await rejected(db, `INSERT INTO games
      (id,room_id,table_id,game_type,engine_version,event_schema_version,initial_state,status)
      VALUES ($1,'room-a',$2,'callbreak',1,1,'{}','active')`,
      [id(103), id(10)], '23505', 'games_one_active_per_table_idx');
    await rejected(db, 'UPDATE games SET table_id=$1 WHERE id=$2',
      [id(20), id(101)], '23503', 'games_table_room_fk');
    await db.query("UPDATE games SET status='completed',completed_at=now() WHERE id=$1", [id(101)]);
    await insertGame(db, 103, id(10)); // A completed match does not block a rematch.
    assert.equal((await db.query('SELECT id FROM games WHERE table_id=$1', [id(10)])).rows.length, 2);
    await insertGame(db, 104); // Old host writes are still compatible.

    await db.exec("INSERT INTO room_ownership (room_id) VALUES ('room-a')");
    await rejected(db, "UPDATE room_ownership SET runtime_status='serving' WHERE room_id='room-a'", [], '23514');
    await db.exec(`INSERT INTO server_instances (instance_id,internal_address)
      VALUES ('server-a','http://server-a:8000')`);
    await db.exec(`UPDATE room_ownership SET owner_instance_id='server-a',
      ownership_epoch=1, fencing_token_hash=decode('abcd','hex'),
      lease_expires_at=now()+interval '30 seconds', runtime_status='recovering'
      WHERE room_id='room-a'`);
    await rejected(db, "DELETE FROM server_instances WHERE instance_id='server-a'", [], '23001');
    await db.exec(`UPDATE room_ownership SET owner_instance_id=NULL,
      fencing_token_hash=NULL,lease_expires_at=NULL,runtime_status='unowned'
      WHERE room_id='room-a'`);
    await db.exec("DELETE FROM server_instances WHERE instance_id='server-a'");
    assert.equal(Number((await db.query('SELECT ownership_epoch FROM room_ownership')).rows[0].ownership_epoch), 1);
    console.log(`PASS: ${upgrade ? 'existing-data upgrade' : 'empty-schema installation'}: table capacity, rollback, rematches, room isolation, ownership constraints`);
    await require('./distributed-inbox-schema.cjs')(db, migrations.find(([version]) => version === 14)[1]);
    await require('./distributed-delivery-schema.cjs')(db, migrations.find(([version]) => version === 15)[1]);
    await db.query(`INSERT INTO game_commands
      (game_id,actor_id,command_id,request_fingerprint,expected_revision,status,resulting_revision)
      VALUES ($1,'legacy','old-receipt','old-format',0,'rejected',0)`, [id(104)]);
    await db.exec(migrations.find(([version]) => version === 16)[1]);
    assert.equal((await db.query("SELECT original_request FROM game_commands WHERE actor_id='legacy'")).rows[0].original_request, null);
    await rejected(db, "UPDATE game_commands SET request_fingerprint='changed' WHERE actor_id='legacy'", [], '23514');
    console.log('PASS: original-request receipt migration preserves legacy rows and prevents mutation');
    const inboxCount = (await db.query('SELECT count(*) AS n FROM command_inbox')).rows[0].n;
    await db.exec(migrations.find(([version]) => version === 17)[1]);
    assert.equal((await db.query('SELECT count(*) AS n FROM command_inbox WHERE original_request IS NULL AND dedup_match_id IS NULL')).rows[0].n, inboxCount);
    await rejected(db, "UPDATE command_inbox SET original_request='{}'", [], '23514');
    console.log('PASS: inbox identity migration preserves legacy rows and prevents request mutation');
    await db.exec("INSERT INTO server_instances (instance_id,internal_address) VALUES ('legacy-boot','http://legacy')");
    await db.exec(migrations.find(([version]) => version === 18)[1]);
    assert.equal((await db.query("SELECT registration_token_hash FROM server_instances WHERE instance_id='legacy-boot'")).rows[0].registration_token_hash, null);
    await rejected(db, "UPDATE server_instances SET internal_address='changed' WHERE instance_id='legacy-boot'", [], '23514');
    await db.exec("UPDATE server_instances SET heartbeat_at=clock_timestamp(),draining=true WHERE instance_id='legacy-boot'");
    console.log('PASS: boot credential migration preserves legacy registrations and immutable identity');
  } finally {
    await db.close();
  }
}

(async () => { await verify(false); await verify(true); })()
  .catch(error => { console.error(error); process.exitCode = 1; });
