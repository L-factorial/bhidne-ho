// PostgreSQL SQL regression without a daemon:
// PGLITE_MODULE=/path/to/@electric-sql/pglite node tests/room-schema-upgrade.cjs
const { PGlite } = require(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const assert = require('node:assert/strict');
const source = readFileSync(join(__dirname, '../app/database.py'), 'utf8');
const upgrade = source.match(/\(12, """([\s\S]*?)"""\)/)[1];
(async () => {
  const db = new PGlite();
  try {
    // Original installed schema: privacy changes edited into migration 1
    // never reach a database that has already applied it.
    await db.exec(`CREATE TABLE users (id uuid PRIMARY KEY);
      CREATE TABLE rooms (id text PRIMARY KEY, name text, creator_id uuid REFERENCES users(id),
        visibility text NOT NULL CHECK (visibility IN ('public', 'friends')));
      INSERT INTO users VALUES ('00000000-0000-0000-0000-000000000001');
      INSERT INTO rooms VALUES ('existing', 'Old friends room', '00000000-0000-0000-0000-000000000001', 'friends');`);
    await assert.rejects(db.exec("INSERT INTO rooms (id,visibility) VALUES ('new','private')"), /rooms_visibility_check/);
    await assert.rejects(db.query('SELECT * FROM room_invitations'), /does not exist/);
    await db.exec(upgrade);
    await db.exec("INSERT INTO rooms (id,visibility) VALUES ('new','private')");
    assert.equal((await db.query("SELECT visibility FROM rooms WHERE id='existing'")).rows[0].visibility, 'private');
    await db.exec("INSERT INTO room_invitations (id,room_id,inviter_id,recipient_id) VALUES ('invite','new','owner','friend')");
    assert.equal((await db.query("SELECT * FROM room_invitations WHERE recipient_id='friend' AND status='pending'")).rows.length, 1);
    assert.equal((await db.query("SELECT id FROM rooms WHERE NOT EXISTS (SELECT 1 FROM deleted_rooms WHERE deleted_rooms.id=rooms.id)")).rows.length, 2);
    // Also safe when bootstrap already created the new tables; retains invitations.
    await db.exec(upgrade);
    assert.equal((await db.query('SELECT * FROM room_invitations')).rows.length, 1);
    assert.equal((await db.query('SELECT * FROM rooms')).rows.length, 2);
    console.log('PASS: legacy PostgreSQL room schema upgrades; private rooms and invitations work; existing data retained');
  } finally { await db.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
