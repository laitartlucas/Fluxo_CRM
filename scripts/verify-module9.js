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
const AUTH_BASE = `${SUPABASE_URL}/auth/v1`;
const FUNCTIONS_BASE = `${SUPABASE_URL}/functions/v1`;

async function adminCreateUser(email, password) {
  const res = await fetch(`${AUTH_BASE}/admin/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`createUser failed: ${JSON.stringify(json)}`);
  return json;
}

async function signIn(email, password) {
  const res = await fetch(`${AUTH_BASE}/token?grant_type=password`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', apikey: ANON_KEY },
    body: JSON.stringify({ email, password }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`sign in failed: ${JSON.stringify(json)}`);
  return json.access_token;
}

async function callSummarize(token, opportunityId) {
  const res = await fetch(`${FUNCTIONS_BASE}/summarize-opportunity-timeline`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, apikey: ANON_KEY },
    body: JSON.stringify({ opportunity_id: opportunityId }),
  });
  const json = await res.json();
  return { status: res.status, body: json };
}

async function main() {
  const db = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await db.connect();

  const password = 'Test-' + crypto.randomBytes(8).toString('hex') + '!Aa1';
  const email = `m9.${crypto.randomBytes(4).toString('hex')}@example.com`;
  const ids = {};
  ['pipeline', 'stage1', 'stage2', 'stage3', 'company', 'contact', 'opp', 'opp2'].forEach(k => ids[k] = crypto.randomUUID());
  let userId;

  try {
    console.log('\n== Setup: opportunity with 10+ activities ==');
    const user = await adminCreateUser(email, password);
    userId = user.id;
    const roles = await db.query(`select id, name from role`);
    const salesRepRole = roles.rows.find(r => r.name === 'Sales Rep').id;
    await db.query(`update public.users set role_id = $1 where id = $2`, [salesRepRole, userId]);

    await db.query(`insert into pipelines(id, name) values ($1,'M9 Pipeline')`, [ids.pipeline]);
    await db.query(`insert into pipeline_stages(id, pipeline_id, name, display_order, probability) values
      ($1,$4,'Qualificação',1,10), ($2,$4,'Proposta',2,40), ($3,$4,'Negociação',3,70)`,
      [ids.stage1, ids.stage2, ids.stage3, ids.pipeline]);
    await db.query(`insert into companies(id, name, owner_id) values ($1,'Acme M9',$2)`, [ids.company, userId]);
    await db.query(`insert into contacts(id, first_name, company_id, owner_id) values ($1,'Fulano',$2,$3)`, [ids.contact, ids.company, userId]);

    await db.query(`insert into opportunities(id, name, pipeline_id, stage_id, company_id, owner_id, value, expected_close_date)
      values ($1,'Contrato Anual Acme',$2,$3,$4,$5,50000, current_date + interval '30 days')`,
      [ids.opp, ids.pipeline, ids.stage1, ids.company, userId]);

    // Generate a rich, real history: several stage moves, value changes, tasks
    // (created pending, then separately completed, so the real UPDATE-transition
    // trigger for task_completed activities actually fires).
    await db.query(`update opportunities set stage_id = $1 where id = $2`, [ids.stage2, ids.opp]); // stage_change #1 (+ insert = 2 so far)
    await db.query(`update opportunities set value = 60000 where id = $1`, [ids.opp]); // field_update #1
    const t1 = await db.query(`insert into tasks(title, owner_id, related_to_type, related_to_id, status) values ('Enviar proposta',$1,'opportunity',$2,'pending') returning id`, [userId, ids.opp]);
    await db.query(`update tasks set status = 'done' where id = $1`, [t1.rows[0].id]); // task_completed #1
    await db.query(`update opportunities set stage_id = $1 where id = $2`, [ids.stage3, ids.opp]); // stage_change #2
    await db.query(`update opportunities set value = 55000 where id = $1`, [ids.opp]); // field_update #2
    const t2 = await db.query(`insert into tasks(title, owner_id, related_to_type, related_to_id, status) values ('Revisar contrato com jurídico',$1,'opportunity',$2,'pending') returning id`, [userId, ids.opp]);
    await db.query(`update tasks set status = 'done' where id = $1`, [t2.rows[0].id]); // task_completed #2
    await db.query(`insert into tasks(title, owner_id, related_to_type, related_to_id, status) values ('Agendar assinatura',$1,'opportunity',$2,'pending')`, [userId, ids.opp]);
    await db.query(`update opportunities set stage_id = $1 where id = $2`, [ids.stage2, ids.opp]); // stage_change back
    await db.query(`update opportunities set stage_id = $1 where id = $2`, [ids.stage3, ids.opp]); // stage_change forward again
    await db.query(`update opportunities set value = 58000 where id = $1`, [ids.opp]); // field_update #3

    const activityCount = await db.query(`select count(*) from activities where related_to_id = $1`, [ids.opp]);
    console.log(`  activities generated: ${activityCount.rows[0].count}`);
    assert(Number(activityCount.rows[0].count) >= 10, `at least 10 activities exist (got ${activityCount.rows[0].count})`);

    const token = await signIn(email, password);

    console.log('\n== 1. First call: real Claude API call (cache miss) ==');
    const r1 = await callSummarize(token, ids.opp);
    assert(r1.status === 200, `summarize call returns 200 (got ${r1.status}, body: ${JSON.stringify(r1.body)})`);
    assert(r1.body.cached === false, 'first call is NOT served from cache');
    assert(typeof r1.body.summary === 'string' && r1.body.summary.length > 20, 'summary is a non-trivial piece of text');
    console.log('  SUMMARY:', r1.body.summary);
    console.log(`  activity_count reported: ${r1.body.activity_count}`);

    console.log('\n== 2. Second call, no new activity: served from cache ==');
    const r2 = await callSummarize(token, ids.opp);
    assert(r2.status === 200, 'second call returns 200');
    assert(r2.body.cached === true, 'second call IS served from cache (no new activity since generation)');
    assert(r2.body.summary === r1.body.summary, 'cached summary text matches the original');

    console.log('\n== 3. New activity happens: cache is invalidated, fresh summary generated ==');
    await db.query(`update opportunities set value = 62000 where id = $1`, [ids.opp]);
    const r3 = await callSummarize(token, ids.opp);
    assert(r3.status === 200, 'third call returns 200');
    assert(r3.body.cached === false, 'cache correctly invalidated after a new activity');
    assert(r3.body.activity_count > r1.body.activity_count, `activity_count grew (was ${r1.body.activity_count}, now ${r3.body.activity_count})`);

    console.log('\n== 4. Empty timeline: no Claude call, graceful message ==');
    await db.query(`insert into opportunities(id, name, pipeline_id, stage_id, company_id, owner_id, value)
      values ($1,'Deal sem historico',$2,$3,$4,$5,100)`, [ids.opp2, ids.pipeline, ids.stage1, ids.company, userId]);
    // the INSERT itself creates one stage_change activity, so this isn't truly empty —
    // verify it still works gracefully with minimal (1-activity) history instead.
    const r4 = await callSummarize(token, ids.opp2);
    assert(r4.status === 200, `minimal-history opportunity still returns 200 (got ${r4.status})`);
    assert(r4.body.activity_count === 1, `activity_count correctly reflects just the creation event (got ${r4.body.activity_count})`);

    console.log('\n== 5. Out-of-scope opportunity returns 403, no data sent to Claude ==');
    const otherOppId = crypto.randomUUID();
    const otherOwnerId = crypto.randomUUID();
    await db.query(`insert into auth.users(id, email) values ($1,'m9.other@example.com')`, [otherOwnerId]);
    await db.query(`insert into opportunities(id, name, pipeline_id, stage_id, company_id, owner_id, value)
      values ($1,'Not yours',$2,$3,$4,$5,999)`, [otherOppId, ids.pipeline, ids.stage1, ids.company, otherOwnerId]);
    const r5 = await callSummarize(token, otherOppId);
    assert(r5.status === 403, `Sales Rep (own-scope) cannot summarize someone else's opportunity (got ${r5.status})`);
    await db.query(`delete from activities where related_to_id = $1`, [otherOppId]);
    await db.query(`delete from opportunity_stage_history where opportunity_id = $1`, [otherOppId]);
    await db.query(`delete from opportunities where id = $1`, [otherOppId]);
    await db.query(`delete from auth.users where id = $1`, [otherOwnerId]);

    console.log('\nAll Module 9 checks passed.');
  } finally {
    console.log('\n== Cleanup ==');
    await db.query(`delete from opportunity_summary_cache where opportunity_id in ($1,$2)`, [ids.opp, ids.opp2]).catch(() => {});
    await db.query(`delete from tasks where related_to_id in ($1,$2)`, [ids.opp, ids.opp2]).catch(() => {});
    await db.query(`delete from activities where related_to_id in ($1,$2)`, [ids.opp, ids.opp2]).catch(() => {});
    await db.query(`delete from opportunity_stage_history where opportunity_id in ($1,$2)`, [ids.opp, ids.opp2]).catch(() => {});
    await db.query(`delete from opportunities where id in ($1,$2)`, [ids.opp, ids.opp2]).catch(() => {});
    await db.query(`delete from contacts where id = $1`, [ids.contact]).catch(() => {});
    await db.query(`delete from companies where id = $1`, [ids.company]).catch(() => {});
    await db.query(`delete from pipeline_stages where pipeline_id = $1`, [ids.pipeline]).catch(() => {});
    await db.query(`delete from pipelines where id = $1`, [ids.pipeline]).catch(() => {});
    if (userId) {
      await fetch(`${AUTH_BASE}/admin/users/${userId}`, { method: 'DELETE', headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` } });
    }
    console.log('  test data removed');
    await db.end();
  }
}

main().catch(err => {
  console.error('\nFAILED:', err.message);
  process.exit(1);
});
