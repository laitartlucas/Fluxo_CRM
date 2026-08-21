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
  await client.query('begin');

  try {
    console.log('\n== 1. FK + trigger: inserting into auth.users mimics real signup/invite ==');
    const userId = crypto.randomUUID();
    await client.query(
      `insert into auth.users (id, email, raw_user_meta_data)
       values ($1, 'novo.usuario@empresa.com', '{"full_name":"Novo Usuario"}'::jsonb)`,
      [userId]
    );

    const domainUser = await client.query(`select id, email, full_name, is_active from public.users where id = $1`, [userId]);
    assert(domainUser.rows.length === 1, 'trigger auto-created the public.users row');
    assert(domainUser.rows[0].email === 'novo.usuario@empresa.com', 'email copied correctly from auth.users');
    assert(domainUser.rows[0].full_name === 'Novo Usuario', 'full_name extracted correctly from raw_user_meta_data');
    assert(domainUser.rows[0].is_active === true, 'new user defaults to is_active = true');

    console.log('\n== 2. FK identity: public.users.id cannot diverge from auth.users.id ==');
    let failed = false;
    try {
      await client.query('savepoint sp1');
      await client.query(`insert into public.users (id, email) values (gen_random_uuid(), 'orphan@empresa.com')`);
    } catch (e) { failed = true; }
    await client.query('rollback to savepoint sp1');
    assert(failed, 'cannot insert a public.users row whose id has no matching auth.users row');

    console.log('\n== 3. Custom Access Token Hook: active user passes through ==');
    const activeEvent = { user_id: userId, claims: { sub: userId } };
    const activeResult = await client.query(`select public.custom_access_token_hook($1::jsonb) as result`, [JSON.stringify(activeEvent)]);
    const r = activeResult.rows[0].result;
    assert(r.user_id === userId && r.claims.sub === userId, 'active user: hook returns event unchanged (login allowed)');

    console.log('\n== 4. Custom Access Token Hook: deactivated user is rejected ==');
    await client.query(`update public.users set is_active = false where id = $1`, [userId]);
    let hookFailed = false;
    let hookError = null;
    try {
      await client.query('savepoint sp2');
      await client.query(`select public.custom_access_token_hook($1::jsonb) as result`, [JSON.stringify(activeEvent)]);
    } catch (e) { hookFailed = true; hookError = e.message; }
    await client.query('rollback to savepoint sp2');
    assert(hookFailed, `deactivated user: hook raises exception, blocking token issuance (error: "${hookError}")`);

    console.log('\n== 5. ON DELETE CASCADE from auth.users to public.users ==');
    await client.query(`delete from auth.users where id = $1`, [userId]);
    const afterDelete = await client.query(`select id from public.users where id = $1`, [userId]);
    assert(afterDelete.rows.length === 0, 'deleting the auth.users row cascades and removes the public.users row');

    console.log('\n== 6. Multiple concurrent invites each get exactly one row ==');
    const userIdA = crypto.randomUUID();
    const userIdB = crypto.randomUUID();
    await client.query(`insert into auth.users (id, email) values ($1, 'a@empresa.com'), ($2, 'b@empresa.com')`, [userIdA, userIdB]);
    const bothRows = await client.query(`select id, email from public.users where id in ($1, $2) order by email`, [userIdA, userIdB]);
    assert(bothRows.rows.length === 2, 'two distinct invites produce two distinct public.users rows');

    console.log('\nAll Module 2 checks passed.');
  } finally {
    await client.query('rollback');
    console.log('\n(test data rolled back)');
  }
  await client.end();
}

main().catch(err => {
  console.error('\nFAILED:', err.message);
  process.exit(1);
});
