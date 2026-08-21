require('dotenv').config({ quiet: true });
const { Client } = require('pg');
const crypto = require('crypto');

function assert(cond, msg) {
  if (!cond) throw new Error('ASSERTION FAILED: ' + msg);
  console.log('  ok:', msg);
}

async function asUser(client, userId) {
  await client.query('begin');
  await client.query('set local role authenticated');
  if (userId) {
    await client.query(`set local request.jwt.claim.sub = '${userId}'`);
  }
}

async function endAsUser(client) {
  await client.query('rollback');
}

async function main() {
  const admin = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await admin.connect();

  const ids = {};
  ['teamA', 'teamB', 'repA1', 'repA2', 'repB1', 'managerA', 'adminUser', 'readonlyUser',
   'companyA1', 'companyB1', 'oppA1', 'oppB1']
    .forEach(k => ids[k] = crypto.randomUUID());

  let roleByName = {};

  console.log('\n== Setup (as postgres, bypasses RLS) ==');
  await admin.query('begin');
  try {
    const roles = await admin.query(`select id, name from public.role`);
    roleByName = Object.fromEntries(roles.rows.map(r => [r.name, r.id]));

    await admin.query(`insert into public.teams(id, name) values ($1,'Team A'), ($2,'Team B')`, [ids.teamA, ids.teamB]);

    async function makeUser(id, email, roleName, teamId) {
      await admin.query(`insert into auth.users(id, email) values ($1,$2)`, [id, email]);
      await admin.query(`update public.users set role_id = $2 where id = $1`, [id, roleByName[roleName]]);
      if (teamId) await admin.query(`insert into team_members(team_id, user_id) values ($1,$2)`, [teamId, id]);
    }

    await makeUser(ids.repA1, 'repa1@test.com', 'Sales Rep', ids.teamA);
    await makeUser(ids.repA2, 'repa2@test.com', 'Sales Rep', ids.teamA);
    await makeUser(ids.repB1, 'repb1@test.com', 'Sales Rep', ids.teamB);
    await makeUser(ids.managerA, 'managera@test.com', 'Manager', ids.teamA);
    await makeUser(ids.adminUser, 'admin@test.com', 'Admin', null);
    await makeUser(ids.readonlyUser, 'readonly@test.com', 'Read-only', null);

    await admin.query(`insert into companies(id, name, owner_id) values ($1,'Company A1',$2), ($3,'Company B1',$4)`,
      [ids.companyA1, ids.repA1, ids.companyB1, ids.repB1]);

    const pipeline = await admin.query(`insert into pipelines(name) values ('Test Pipeline') returning id`);
    const stage = await admin.query(`insert into pipeline_stages(pipeline_id,name,display_order) values ($1,'S1',1) returning id`, [pipeline.rows[0].id]);

    await admin.query(`insert into opportunities(id, name, pipeline_id, stage_id, company_id, owner_id, value)
      values ($1,'Opp A1',$2,$3,$4,$5,1000), ($6,'Opp B1',$2,$3,$7,$8,2000)`,
      [ids.oppA1, pipeline.rows[0].id, stage.rows[0].id, ids.companyA1, ids.repA1,
       ids.oppB1, ids.companyB1, ids.repB1]);

    console.log('  fixtures created: 2 teams, 6 users (2 reps team A, 1 rep team B, 1 manager team A, 1 admin, 1 read-only), 2 companies, 2 opportunities');
    await admin.query('commit');
  } catch (e) {
    await admin.query('rollback');
    throw e;
  }

  try {
    console.log('\n== 1. Sales Rep sees only own opportunities ==');
    await asUser(admin, ids.repA1);
    let res = await admin.query(`select id from opportunities`);
    assert(res.rows.length === 1 && res.rows[0].id === ids.oppA1, 'repA1 sees exactly Opp A1 (own), not Opp B1');
    await endAsUser(admin);

    console.log("\n== 2. Sales Rep cannot see teammate's opportunity (own scope, not team) ==");
    await asUser(admin, ids.repA2);
    res = await admin.query(`select id from opportunities`);
    assert(res.rows.length === 0, 'repA2 (teammate of repA1, but Sales Rep = own scope) sees zero opportunities');
    await endAsUser(admin);

    console.log("\n== 3. Manager sees whole team's opportunities, not other team ==");
    await asUser(admin, ids.managerA);
    res = await admin.query(`select id from opportunities order by id`);
    assert(res.rows.length === 1 && res.rows[0].id === ids.oppA1, 'managerA (team A) sees Opp A1 only, not Opp B1 (team B)');
    await endAsUser(admin);

    console.log('\n== 4. Admin sees everything ==');
    await asUser(admin, ids.adminUser);
    res = await admin.query(`select id from opportunities order by id`);
    assert(res.rows.length === 2, 'adminUser sees both opportunities');
    await endAsUser(admin);

    console.log('\n== 5. Read-only sees everything but cannot write ==');
    await asUser(admin, ids.readonlyUser);
    res = await admin.query(`select id from opportunities`);
    assert(res.rows.length === 2, 'readonlyUser sees both opportunities (select scope = all)');
    const upd = await admin.query(`update opportunities set value = 9999 where id = $1`, [ids.oppA1]);
    assert(upd.rowCount === 0, 'readonlyUser UPDATE on any opportunity silently affects 0 rows (no permission at all)');
    await endAsUser(admin);

    console.log('\n== 6. Out-of-scope UPDATE fails silently (no error, no leak) ==');
    await asUser(admin, ids.repB1);
    let updateThrew = false;
    let updateResult;
    try {
      updateResult = await admin.query(`update opportunities set value = 5000 where id = $1`, [ids.oppA1]);
    } catch (e) { updateThrew = true; }
    assert(!updateThrew, "repB1 updating repA1's opportunity does NOT throw an error");
    assert(updateResult.rowCount === 0, "repB1 updating repA1's opportunity affects 0 rows (RLS filtered it out silently)");
    await endAsUser(admin);

    console.log('\n== 7. INSERT respects scope: Sales Rep cannot create a record owned by someone else ==');
    await asUser(admin, ids.repA1);
    let insertFailed = false;
    try {
      await admin.query(`insert into companies(name, owner_id) values ('Sneaky', $1)`, [ids.repA2]);
    } catch (e) { insertFailed = true; }
    assert(insertFailed, 'repA1 cannot INSERT a company with owner_id = someone else (own scope only)');
    await endAsUser(admin);

    console.log('\n== 8. Privilege escalation guard: user cannot self-promote via UPDATE ==');
    await asUser(admin, ids.repA1);
    await admin.query(`update public.users set full_name = 'Rep A1 Renamed', role_id = $1, is_active = false where id = $2`,
      [roleByName['Admin'], ids.repA1]);
    const selfCheck = await admin.query(`select full_name, role_id, is_active from public.users where id = $1`, [ids.repA1]);
    assert(selfCheck.rows[0].full_name === 'Rep A1 Renamed', 'allowed field (full_name) DID change');
    assert(selfCheck.rows[0].is_active === true, 'protected field (is_active) was silently reverted, not set to false');
    assert(selfCheck.rows[0].role_id === roleByName['Sales Rep'], 'protected field (role_id) was silently reverted, not promoted to Admin');
    await endAsUser(admin);

    console.log('\n== 9. record_share exception grants visibility outside normal scope ==');
    await asUser(admin, ids.adminUser);
    await admin.query(`insert into record_share(resource_type, resource_id, shared_with_user_id, granted_by) values ('opportunity',$1,$2,$3)`,
      [ids.oppA1, ids.repB1, ids.adminUser]);
    await admin.query('commit');

    await asUser(admin, ids.repB1);
    res = await admin.query(`select id from opportunities where id = $1`, [ids.oppA1]);
    assert(res.rows.length === 1, 'repB1 can now see Opp A1 via record_share, despite being out of normal scope');
    await endAsUser(admin);

    await admin.query(`delete from record_share where resource_id = $1`, [ids.oppA1]);

    console.log('\n== 10. Unauthenticated (anon) role sees nothing ==');
    await admin.query('begin');
    await admin.query('set local role anon');
    res = await admin.query(`select id from opportunities`);
    assert(res.rows.length === 0, 'anon role (no auth.uid()) sees zero opportunities');
    const anonUsers = await admin.query(`select id from users`);
    assert(anonUsers.rows.length === 0, 'anon role sees zero users (even the open "select for all" policy requires auth.uid() is not null)');
    await admin.query('rollback');

    console.log('\nAll Module 3 checks passed.');
  } finally {
    console.log('\n== Cleanup ==');
    await admin.query('delete from record_share');
    await admin.query(`delete from opportunity_contacts where opportunity_id in ($1,$2)`, [ids.oppA1, ids.oppB1]);
    await admin.query(`delete from opportunity_stage_history where opportunity_id in ($1,$2)`, [ids.oppA1, ids.oppB1]);
    await admin.query(`delete from opportunities where id in ($1,$2)`, [ids.oppA1, ids.oppB1]);
    await admin.query(`delete from pipeline_stages`);
    await admin.query(`delete from pipelines`);
    await admin.query(`delete from companies where id in ($1,$2)`, [ids.companyA1, ids.companyB1]);
    await admin.query(`delete from auth.users where id in ($1,$2,$3,$4,$5,$6)`,
      [ids.repA1, ids.repA2, ids.repB1, ids.managerA, ids.adminUser, ids.readonlyUser]);
    await admin.query(`delete from teams where id in ($1,$2)`, [ids.teamA, ids.teamB]);
    console.log('  test data removed');
    await admin.end();
  }
}

main().catch(err => {
  console.error('\nFAILED:', err.message);
  console.error('detail:', err.detail, '| schema:', err.schema, '| table:', err.table, '| where:', err.where);
  process.exit(1);
});
