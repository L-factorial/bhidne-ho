// Test-only SQL transport: executes production Python store SQL in PostgreSQL/WASM.
const { PGlite } = require(process.env.PGLITE_MODULE);
const readline = require('node:readline');
(async () => {
  const db = new PGlite();
  const lines = readline.createInterface({input: process.stdin});
  for await (const line of lines) {
    try {
      const request = JSON.parse(line);
      const result = request.script ? await db.exec(request.sql) : await db.query(request.sql, request.params.map(v => v && v.__bytes ? new Uint8Array(v.__bytes) : v));
      process.stdout.write(JSON.stringify({result}) + '\n');
    } catch (error) {
      process.stdout.write(JSON.stringify({error: error.message, code: error.code}) + '\n');
    }
  }
  await db.close();
})();
