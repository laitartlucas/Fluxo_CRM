require('dotenv').config({ quiet: true });
const { Client } = require('pg');
const crypto = require('crypto');

function assert(cond, msg) {
  if (!cond) throw new Error('ASSERTION FAILED: ' + msg);
  console.log('  ok:', msg);
}

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  const userId = crypto.randomUUID();

  try {
    console.log('\n== Setup ==');
    await client.query(`insert into auth.users(id, email) values ($1,'ratelimit@test.com')`, [userId]);

    console.log('\n== 1. check_rate_limit allows up to the max, then blocks ==');
    for (let i = 1; i <= 3; i++) {
      const r = await client.query(`select check_rate_limit($1,'test-endpoint',3) as ok`, [userId]);
      assert(r.rows[0].ok === true, `call ${i}/3 within limit returns true`);
    }
    const blocked = await client.query(`select check_rate_limit($1,'test-endpoint',3) as ok`, [userId]);
    assert(blocked.rows[0].ok === false, 'call 4 (exceeds max=3) returns false');

    console.log('\n== 2. different endpoint has an independent counter ==');
    const otherEndpoint = await client.query(`select check_rate_limit($1,'other-endpoint',3) as ok`, [userId]);
    assert(otherEndpoint.rows[0].ok === true, 'a different endpoint is not affected by the first one\'s counter');

    console.log('\n== 3. authenticated/anon roles cannot call check_rate_limit directly (RPC-abuse guard) ==');
    await client.query('begin');
    await client.query('set local role authenticated');
    await client.query(`set local request.jwt.claim.sub = '${userId}'`);
    let denied = false;
    try {
      await client.query(`select check_rate_limit($1,'test-endpoint',999999)`, [userId]);
    } catch (e) { denied = true; }
    assert(denied, 'authenticated role gets permission denied calling check_rate_limit directly');
    await client.query('rollback');

    console.log('\n== 4. authenticated/anon cannot read or write api_rate_limit table directly ==');
    await client.query('begin');
    await client.query('set local role authenticated');
    await client.query(`set local request.jwt.claim.sub = '${userId}'`);
    const rows = await client.query(`select * from api_rate_limit where user_id = $1`, [userId]);
    assert(rows.rows.length === 0, 'authenticated role sees zero rows in api_rate_limit (RLS enabled, no policies = deny-all)');
    await client.query('rollback');

    console.log('\nAll Module 6 DB-level checks passed.');
  } finally {
    console.log('\n== Cleanup ==');
    await client.query('delete from api_rate_limit where user_id = $1', [userId]).catch(() => {});
    await client.query('delete from auth.users where id = $1', [userId]).catch(() => {});
    console.log('  test data removed');
    await client.end();
  }
}

main().catch(err => {
  console.error('\nFAILED:', err.message);
  process.exit(1);
});
