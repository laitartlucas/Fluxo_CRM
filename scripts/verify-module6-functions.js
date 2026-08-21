require('dotenv').config({ quiet: true });
const { Client } = require('pg');
const crypto = require('crypto');

function assert(cond, msg) {
  if (!cond) throw new Error('ASSERTION FAILED: ' + msg);
  console.log('  ok:', msg);
}

const SUPABASE_URL = process.env.SUPABASE_URL;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const FUNCTIONS_BASE = `${SUPABASE_URL}/functions/v1`;
const AUTH_BASE = `${SUPABASE_URL}/auth/v1`;

async function callFunction(name, token, body, method = 'POST') {
  const res = await fetch(`${FUNCTIONS_BASE}/${name}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      apikey: ANON_KEY,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, body: json };
}

async function adminCreateUser(email, password) {
  const res = await fetch(`${AUTH_BASE}/admin/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`createUser failed for ${email}: ${JSON.stringify(json)}`);
  return json;
}

async function adminDeleteUser(id) {
  await fetch(`${AUTH_BASE}/admin/users/${id}`, {
    method: 'DELETE',
    headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
  });
}

async function signInGetToken(email, password) {
  const res = await fetch(`${AUTH_BASE}/token?grant_type=password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: ANON_KEY },
    body: JSON.stringify({ email, password }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`sign in failed for ${email}: ${JSON.stringify(json)}`);
  return json.access_token;
}

async function main() {
  const db = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await db.connect();

  const password = 'Test-' + crypto.randomBytes(8).toString('hex') + '!Aa1';
  const ids = {};
  ['pipeline', 'stage1', 'stage2', 'company'].forEach(k => ids[k] = crypto.randomUUID());
  const createdUserIds = [];
  const createdOppIds = [];
  const createdContactIds = [];
  const testTag = crypto.randomBytes(4).toString('hex');

  try {
    console.log('\n== Setup ==');
    const roles = await db.query(`select id, name from role`);
    const roleByName = Object.fromEntries(roles.rows.map(r => [r.name, r.id]));

    async function createTestUser(label, roleName) {
      const email = `m6.${testTag}.${label}@example.com`;
      const user = await adminCreateUser(email, password);
      createdUserIds.push(user.id);
      await db.query(`update public.users set role_id = $1 where id = $2`, [roleByName[roleName], user.id]);
      return { id: user.id, email };
    }

    const repA = await createTestUser('repA', 'Sales Rep');
    const repB = await createTestUser('repB', 'Sales Rep');
    const adminUser = await createTestUser('admin', 'Admin');
    console.log(`  created 3 real Supabase Auth users (repA, repB, admin), tag=${testTag}`);

    await db.query(`insert into pipelines(id, name) values ($1,'M6 Pipeline')`, [ids.pipeline]);
    await db.query(`insert into pipeline_stages(id, pipeline_id, name, display_order) values
      ($1,$3,'S1',1), ($2,$3,'S2',2)`, [ids.stage1, ids.stage2, ids.pipeline]);
    await db.query(`insert into companies(id, name, owner_id) values ($1,'M6 Co',$2)`, [ids.company, repA.id]);

    const opp = await db.query(`insert into opportunities(name, pipeline_id, stage_id, company_id, owner_id, value)
      values ('M6 Opp',$1,$2,$3,$4,1000) returning id`, [ids.pipeline, ids.stage1, ids.company, repA.id]);
    createdOppIds.push(opp.rows[0].id);

    const repAToken = await signInGetToken(repA.email, password);
    const repBToken = await signInGetToken(repB.email, password);
    const adminToken = await signInGetToken(adminUser.email, password);
    console.log('  signed in as repA, repB, admin — real JWTs obtained');

    console.log('\n== 1. move-opportunity-stage: owner moves their own opportunity ==');
    let r = await callFunction('move-opportunity-stage', repAToken, { opportunity_id: opp.rows[0].id, new_stage_id: ids.stage2 });
    assert(r.status === 200, `repA moving their own opportunity returns 200 (got ${r.status}, body: ${JSON.stringify(r.body)})`);
    assert(r.body.opportunity.stage_id === ids.stage2, 'response reflects the new stage_id');

    console.log('\n== 2. move-opportunity-stage: non-owner, out of scope, gets 403 ==');
    r = await callFunction('move-opportunity-stage', repBToken, { opportunity_id: opp.rows[0].id, new_stage_id: ids.stage1 });
    assert(r.status === 403, `repB (different Sales Rep, own-scope) moving repA's opportunity returns 403 (got ${r.status})`);
    const stillStage2 = await db.query(`select stage_id from opportunities where id = $1`, [opp.rows[0].id]);
    assert(stillStage2.rows[0].stage_id === ids.stage2, 'no side effect: stage_id unchanged after the 403');

    console.log('\n== 3. move-opportunity-stage: invalid input returns 400 ==');
    r = await callFunction('move-opportunity-stage', repAToken, { opportunity_id: 'not-a-uuid', new_stage_id: ids.stage1 });
    assert(r.status === 400, `malformed opportunity_id returns 400 (got ${r.status})`);

    console.log('\n== 4. move-opportunity-stage: missing auth header returns 401 ==');
    const noAuthRes = await fetch(`${FUNCTIONS_BASE}/move-opportunity-stage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', apikey: ANON_KEY },
      body: JSON.stringify({ opportunity_id: opp.rows[0].id, new_stage_id: ids.stage1 }),
    });
    assert(noAuthRes.status === 401, `no Authorization header returns 401 (got ${noAuthRes.status})`);

    console.log('\n== 5. invite-member: non-admin caller gets 403 ==');
    r = await callFunction('invite-member', repAToken, { email: `m6.${testTag}.blocked@example.com`, role_name: 'Sales Rep' });
    assert(r.status === 403, `Sales Rep calling invite-member returns 403 (got ${r.status}, body: ${JSON.stringify(r.body)})`);

    console.log('\n== 6. invite-member: admin caller succeeds, role is assigned ==');
    // inviteUserByEmail actually attempts delivery, so @example.com (rejected
    // as non-deliverable) doesn't work here like it does for admin.createUser.
    // Using a real, deliverable address (+alias, so it's isolated in the inbox).
    const inviteEmail = `laitartlucas+m6test${testTag}@gmail.com`;
    r = await callFunction('invite-member', adminToken, { email: inviteEmail, full_name: 'Convidado Teste', role_name: 'Manager' });
    assert(r.status === 201, `admin inviting a new member returns 201 (got ${r.status}, body: ${JSON.stringify(r.body)})`);
    if (r.body?.user_id) createdUserIds.push(r.body.user_id);
    const invitedRow = await db.query(`select u.role_id, r.name from public.users u join role r on r.id = u.role_id where u.id = $1`, [r.body.user_id]);
    assert(invitedRow.rows[0]?.name === 'Manager', `invited user's role_id correctly resolves to Manager (got ${invitedRow.rows[0]?.name})`);

    console.log('\n== 7. invite-member: unknown role_name returns 400 ==');
    r = await callFunction('invite-member', adminToken, { email: `m6.${testTag}.badrole@example.com`, role_name: 'Nonexistent Role' });
    assert(r.status === 400, `unknown role_name returns 400 (got ${r.status})`);

    console.log('\n== 8. bulk-import-contacts: inserts, skips duplicate email ==');
    const dupEmail = `m6.${testTag}.dup@example.com`;
    await db.query(`insert into contacts(first_name, email, owner_id) values ('Existing', $1, $2)`, [dupEmail, repA.id]);
    r = await callFunction('bulk-import-contacts', repAToken, {
      contacts: [
        { first_name: 'Novo1', email: `m6.${testTag}.new1@example.com` },
        { first_name: 'Duplicado', email: dupEmail },
        { first_name: 'Novo2', email: `m6.${testTag}.new2@example.com` },
      ],
    });
    assert(r.status === 200, `bulk import call returns 200 (got ${r.status}, body: ${JSON.stringify(r.body)})`);
    assert(r.body.inserted === 2, `2 new contacts inserted, 1 skipped as duplicate (got inserted=${r.body.inserted})`);
    assert(r.body.skipped_duplicates.includes(dupEmail), 'the duplicate email is reported back');
    const newContacts = await db.query(`select id from contacts where email like $1`, [`m6.${testTag}.new%`]);
    createdContactIds.push(...newContacts.rows.map(row => row.id));

    console.log('\n== 9. bulk-import-contacts: missing first_name returns 400, nothing inserted ==');
    const beforeCount = await db.query(`select count(*) from contacts where owner_id = $1`, [repA.id]);
    r = await callFunction('bulk-import-contacts', repAToken, { contacts: [{ email: 'no-name@example.com' }] });
    assert(r.status === 400, `row missing first_name returns 400 (got ${r.status})`);
    const afterCount = await db.query(`select count(*) from contacts where owner_id = $1`, [repA.id]);
    assert(beforeCount.rows[0].count === afterCount.rows[0].count, 'validation failure inserted nothing');

    console.log('\n== 10. get-dashboard-summary: single call returns forecast + tasks + activities ==');
    r = await callFunction('get-dashboard-summary', repAToken, undefined, 'POST');
    assert(r.status === 200, `get-dashboard-summary returns 200 (got ${r.status}, body: ${JSON.stringify(r.body)})`);
    assert('forecast' in r.body && 'pending_tasks' in r.body && 'recent_activities' in r.body,
      'response has forecast + pending_tasks + recent_activities in one payload');
    assert(typeof r.body.forecast.weighted_forecast === 'number', 'forecast.weighted_forecast is a number');
    console.log(`  forecast: ${JSON.stringify(r.body.forecast)}, pending_tasks=${r.body.pending_tasks.length}, recent_activities=${r.body.recent_activities.length}`);

    console.log('\nAll Module 6 Edge Function checks passed.');
  } finally {
    console.log('\n== Cleanup ==');
    for (const id of createdContactIds) await db.query(`delete from contacts where id = $1`, [id]).catch(() => {});
    await db.query(`delete from contacts where owner_id = any($1::uuid[])`, [createdUserIds]).catch(() => {});
    for (const id of createdOppIds) {
      await db.query(`delete from activities where related_to_id = $1`, [id]).catch(() => {});
      await db.query(`delete from opportunity_stage_history where opportunity_id = $1`, [id]).catch(() => {});
      await db.query(`delete from opportunities where id = $1`, [id]).catch(() => {});
    }
    await db.query(`delete from pipeline_stages where pipeline_id = $1`, [ids.pipeline]).catch(() => {});
    await db.query(`delete from pipelines where id = $1`, [ids.pipeline]).catch(() => {});
    await db.query(`delete from companies where id = $1`, [ids.company]).catch(() => {});
    await db.query(`delete from api_rate_limit where user_id = any($1::uuid[])`, [createdUserIds]).catch(() => {});
    for (const id of createdUserIds) {
      await adminDeleteUser(id);
    }
    console.log(`  removed ${createdUserIds.length} test auth users + associated data`);
    await db.end();
  }
}

main().catch(err => {
  console.error('\nFAILED:', err.message);
  process.exit(1);
});
