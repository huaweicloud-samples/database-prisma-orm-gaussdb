// GaussDB wire-protocol probe (V8): verifies node-pg client behaviors against
// a real GaussDB instance before wiring it into the gaussdb driver adapter.
// Usage: node scripts/gaussdb-wire-probe.mjs <GAUSSDB_URL>
// e.g.   node scripts/gaussdb-wire-probe.mjs "postgresql://user:<PASSWORD>@host:5432/db"
// (the @ in the password must be percent-encoded as %40)
import pg from 'pg';

const url = process.argv[2];
if (!url) {
  console.error('usage: node gaussdb-wire-probe.mjs <GAUSSDB_URL>');
  process.exit(1);
}

const client = new pg.Client({ connectionString: url, application_name: 'gaussdb-wire-probe' });
await client.connect();
console.log('[OK] connect:', (await client.query('select version()')).rows[0].version);

const ext = await client.query({ text: 'select $1::int + $2::int as sum', values: [40, 2] });
console.log('[OK] extended protocol:', ext.rows[0].sum);

const ps = await client.query({
  name: 'wire_probe_ps',
  text: 'select $1::text as v',
  values: ['hi'],
});
console.log('[OK] named prepared statement:', ps.rows[0].v);

await client.query('begin');
// GaussDB (A mode) rejects `serial` on temp tables (0A000: The serial column
// cannot be created on a temporary table) — use a plain integer column so this
// probe still covers temp table + extended-protocol insert + RETURNING + commit.
await client.query('create temp table wire_probe (id integer primary key, v text)');
const ins = await client.query('insert into wire_probe (id, v) values ($1, $2) returning id', [
  1,
  'r1',
]);
await client.query('commit');
console.log('[OK] temp table + returning + transaction, id =', ins.rows[0].id);

await client.end();
