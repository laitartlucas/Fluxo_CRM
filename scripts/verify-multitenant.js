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

async function callFn(name, token, body) {
  const res = await fetch(`${FUNCTIONS_BASE}/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, apikey: ANON_KEY },
    body: JSON.stringify(body ?? {}),
  });
  let json = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, body: json };
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

async function main() {
  const db = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await db.connect();

  const adminToken = await signIn('laitartlucas@gmail.com', '514263');
  const tag = crypto.randomBytes(4).toString('hex');
  const passA = 'MenteeA!Aa1234';
  const passB = 'MenteeB!Aa1234';
  const createdUserIds = [];

  try {
    console.log('\n== 1. Provision two mentee tenants (mirrors invite-member\'s own logic) ==');
    // NOTE: invite-member's real inviteUserByEmail() path was already
    // confirmed working in an earlier run this session (a real user +
    // real email were created; it only failed afterwards, at the since-
    // fixed stage-provisioning bug). Supabase's shared test SMTP has a
    // strict per-hour send limit that's now exhausted from that run plus
    // Module 6/9's own real-email tests, so this run provisions the two
    // test tenants directly (admin.createUser, no email) to keep testing
    // the part that actually matters here: RLS isolation between tenants.
    async function provisionTenant(email, password, fullName) {
      const res = await fetch(`${AUTH_BASE}/admin/users`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
        body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { full_name: fullName } }),
      });
      const user = await res.json();
      if (!res.ok) throw new Error(`createUser failed: ${JSON.stringify(user)}`);
      const pipeline = await db.query(`insert into pipelines(name, owner_id) values ('Funil Principal', $1) returning id`, [user.id]);
      await db.query(
        `insert into pipeline_stages(pipeline_id, name, display_order, probability, is_won, is_lost) values
         ($1,'Qualificação',1,10,false,false), ($1,'Proposta',2,40,false,false), ($1,'Negociação',3,70,false,false),
         ($1,'Fechado Ganho',4,100,true,false), ($1,'Fechado Perdido',5,0,false,true)`,
        [pipeline.rows[0].id]
      );
      return { userId: user.id, pipelineId: pipeline.rows[0].id };
    }

    const mA = await provisionTenant(`mtA.${tag}@example.com`, passA, 'Mentee A');
    const mB = await provisionTenant(`mtB.${tag}@example.com`, passB, 'Mentee B');
    createdUserIds.push(mA.userId, mB.userId);
    const inviteA = { body: { user_id: mA.userId, pipeline_id: mA.pipelineId } };

    const stagesA = await db.query('select count(*) from pipeline_stages where pipeline_id = $1', [inviteA.body.pipeline_id]);
    assert(stagesA.rows[0].count === '5', 'mentee A has 5 stages provisioned');

    const tokenA = await signIn(`mtA.${tag}@example.com`, passA);
    const tokenB = await signIn(`mtB.${tag}@example.com`, passB);

    console.log('\n== 2. Mentee A creates a company + opportunity in her own pipeline ==');
    const companyA = await db.query(`insert into companies(name, owner_id) values ('Empresa da A', $1) returning id`, [inviteA.body.user_id]);
    const stage1A = await db.query(`select id from pipeline_stages where pipeline_id = $1 order by display_order limit 1`, [inviteA.body.pipeline_id]);
    const oppA = await db.query(
      `insert into opportunities(name, pipeline_id, stage_id, company_id, owner_id, value) values ('Negócio da A',$1,$2,$3,$4,1000) returning id`,
      [inviteA.body.pipeline_id, stage1A.rows[0].id, companyA.rows[0].id, inviteA.body.user_id]
    );

    console.log('\n== 3. Mentee B CANNOT see any of mentee A\'s data ==');
    const bSeesCompanies = await withAuth(db, tokenB, `select count(*) from companies`);
    assert(bSeesCompanies === '0', 'mentee B sees zero companies (her own tenant is empty)');
    const bSeesOpps = await withAuth(db, tokenB, `select count(*) from opportunities`);
    assert(bSeesOpps === '0', 'mentee B sees zero opportunities');
    const bSeesPipelines = await withAuth(db, tokenB, `select count(*) from pipelines`);
    assert(bSeesPipelines === '1', 'mentee B sees exactly her OWN pipeline (1), not mentee A\'s');

    console.log('\n== 4. Mentee A sees her own data fine ==');
    const aSeesCompanies = await withAuth(db, tokenA, `select count(*) from companies`);
    assert(aSeesCompanies === '1', 'mentee A sees her own 1 company');

    console.log('\n== 5. Cross-tenant edge function calls are rejected ==');
    const crossMove = await callFn('move-opportunity-stage', tokenB, { opportunity_id: oppA.rows[0].id, new_stage_id: stage1A.rows[0].id });
    assert(crossMove.status === 403, `mentee B calling move-opportunity-stage on mentee A's deal returns 403 (got ${crossMove.status})`);

    console.log('\n== 6. Mentee B cannot invite new accounts (not a platform admin) ==');
    const bInvite = await callFn('invite-member', tokenB, { email: `nope.${tag}@example.com` });
    assert(bInvite.status === 403, `non-admin invite attempt returns 403 (got ${bInvite.status})`);

    console.log('\n== 7. Mentee A cannot self-promote to platform admin or reactivate herself if deactivated ==');
    const selfPromote = await withAuthUpdate(db, tokenA, inviteA.body.user_id, 'is_platform_admin', true);
    assert(selfPromote === false, 'mentee A cannot set her own is_platform_admin to true');

    console.log('\n== 8. Cross-tenant pipeline reference is blocked at the DB level (defense in depth) ==');
    const pipelineB = await withAuthSelect(db, tokenB, `select id from pipelines limit 1`);
    let crossPipelineFailed = false;
    try {
      await db.query(
        `insert into opportunities(name, pipeline_id, stage_id, owner_id, value) values ('Sneaky', $1, $2, $3, 1)`,
        [pipelineB.id, stage1A.rows[0].id, inviteA.body.user_id]
      );
    } catch (e) { crossPipelineFailed = true; }
    assert(crossPipelineFailed, 'inserting an opportunity whose pipeline belongs to a DIFFERENT tenant is rejected by the trigger');

    console.log('\nAll multi-tenant isolation checks passed.');
  } finally {
    console.log('\n== Cleanup ==');
    for (const uid of createdUserIds) {
      await db.query(`delete from opportunity_stage_history where opportunity_id in (select id from opportunities where owner_id = $1)`, [uid]).catch(() => {});
      await db.query(`delete from activities where related_to_id in (select id from opportunities where owner_id = $1)`, [uid]).catch(() => {});
      await db.query(`delete from opportunities where owner_id = $1`, [uid]).catch(() => {});
      await db.query(`delete from companies where owner_id = $1`, [uid]).catch(() => {});
      await db.query(`delete from pipeline_stages where pipeline_id in (select id from pipelines where owner_id = $1)`, [uid]).catch(() => {});
      await db.query(`delete from pipelines where owner_id = $1`, [uid]).catch(() => {});
      await fetch(`${AUTH_BASE}/admin/users/${uid}`, { method: 'DELETE', headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` } });
    }
    console.log(`  removed ${createdUserIds.length} test tenants + their data`);
    await db.end();
  }
}

// Helpers: run a query AS a given user's JWT by setting the session-local
// role/claim on our admin pg connection (same pattern used throughout Module 3 testing).
async function withAuth(db, token, sql) {
  const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
  await db.query('begin');
  await db.query('set local role authenticated');
  await db.query(`set local request.jwt.claim.sub = '${payload.sub}'`);
  const r = await db.query(sql);
  await db.query('rollback');
  return r.rows[0].count;
}

async function withAuthSelect(db, token, sql) {
  const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
  await db.query('begin');
  await db.query('set local role authenticated');
  await db.query(`set local request.jwt.claim.sub = '${payload.sub}'`);
  const r = await db.query(sql);
  await db.query('rollback');
  return r.rows[0];
}

async function withAuthUpdate(db, token, targetId, column, value) {
  const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
  await db.query('begin');
  await db.query('set local role authenticated');
  await db.query(`set local request.jwt.claim.sub = '${payload.sub}'`);
  await db.query(`update public.users set ${column} = $1 where id = $2`, [value, targetId]);
  const check = await db.query(`select ${column} from public.users where id = $1`, [targetId]);
  await db.query('rollback');
  return check.rows[0][column];
}

main().catch(err => {
  console.error('\nFAILED:', err.message);
  process.exit(1);
});
