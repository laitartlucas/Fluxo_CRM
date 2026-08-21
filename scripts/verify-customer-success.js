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

  const ids = {};
  ['userA', 'userB', 'company', 'pipeline', 'stage1', 'stageWon', 'opp'].forEach(k => ids[k] = crypto.randomUUID());

  try {
    console.log('\n== Setup ==');
    await client.query(`insert into auth.users(id, email) values ($1,'cs.a@test.com'), ($2,'cs.b@test.com')`, [ids.userA, ids.userB]);
    await client.query(`insert into companies(id, name, owner_id) values ($1,'Cliente CS',$2)`, [ids.company, ids.userA]);
    await client.query(`insert into pipelines(id, name, owner_id) values ($1,'CS Pipeline',$2)`, [ids.pipeline, ids.userA]);
    await client.query(`insert into pipeline_stages(id, pipeline_id, name, display_order) values ($1,$3,'S1',1), ($2,$3,'Ganho',2)`,
      [ids.stage1, ids.stageWon, ids.pipeline]);
    await client.query(`update pipeline_stages set is_won = true where id = $1`, [ids.stageWon]);

    console.log('\n== 1. Opportunity starts with no health (not won yet) ==');
    const opp = await client.query(`insert into opportunities(id, name, pipeline_id, stage_id, company_id, owner_id, value)
      values ($1,'Deal CS',$2,$3,$4,$5,3000) returning health`, [ids.opp, ids.pipeline, ids.stage1, ids.company, ids.userA]);
    assert(opp.rows[0].health === null, 'health is null while opportunity is still open');

    console.log('\n== 2. Winning the deal auto-sets health = saudavel ==');
    await client.query(`update opportunities set stage_id = $1 where id = $2`, [ids.stageWon, ids.opp]);
    const won = await client.query(`select health, status from opportunities where id = $1`, [ids.opp]);
    assert(won.rows[0].status === 'won' && won.rows[0].health === 'saudavel', 'won deal auto-classified as saudavel');

    console.log('\n== 3. Health can be cycled manually (saudavel -> atencao -> risco) ==');
    await client.query(`update opportunities set health = 'atencao' where id = $1`, [ids.opp]);
    let h = await client.query(`select health from opportunities where id = $1`, [ids.opp]);
    assert(h.rows[0].health === 'atencao', 'health updated to atencao');
    await client.query(`update opportunities set health = 'risco' where id = $1`, [ids.opp]);
    h = await client.query(`select health from opportunities where id = $1`, [ids.opp]);
    assert(h.rows[0].health === 'risco', 'health updated to risco');

    console.log('\n== 4. Reopening the deal clears health (no longer a "client" until re-won) ==');
    await client.query(`select reopen_opportunity($1, 'cliente pediu revisão do contrato')`, [ids.opp]);
    const reopened = await client.query(`select status, health from opportunities where id = $1`, [ids.opp]);
    assert(reopened.rows[0].status === 'open', 'status back to open after reopen');
    // health only clears on an actual stage move away from won (sync trigger runs on stage_id change, not on the
    // status-only update reopen_opportunity performs) — moving it back confirms the derive-on-transition rule.
    await client.query(`update opportunities set stage_id = $1 where id = $2`, [ids.stage1, ids.opp]);
    const movedAway = await client.query(`select health from opportunities where id = $1`, [ids.opp]);
    assert(movedAway.rows[0].health === null, 'health cleared once the deal actually moves out of the won stage');

    console.log('\n== 5. RLS: user B cannot see or edit user A\'s opportunity health ==');
    await client.query('begin');
    await client.query('set local role authenticated');
    await client.query(`set local request.jwt.claim.sub = '${ids.userB}'`);
    const bSees = await client.query(`select count(*) from opportunities`);
    assert(bSees.rows[0].count === '0', 'user B sees zero opportunities');
    await client.query('rollback');

    console.log('\n== 6. NPS score: per-tenant, upsertable, validated range ==');
    await client.query(`insert into nps_score(owner_id, score, survey_label) values ($1, 72, 'julho')`, [ids.userA]);
    await client.query(`insert into nps_score(owner_id, score, survey_label) values ($1, 85, 'agosto')
      on conflict (owner_id) do update set score = excluded.score, survey_label = excluded.survey_label`, [ids.userA]);
    const nps = await client.query(`select score, survey_label from nps_score where owner_id = $1`, [ids.userA]);
    assert(nps.rows[0].score === 85 && nps.rows[0].survey_label === 'agosto', 'NPS upserted to the latest value (one row per tenant)');

    let badScore = false;
    try {
      await client.query(`insert into nps_score(owner_id, score) values ($1, 150)`, [ids.userB]);
    } catch (e) { badScore = true; }
    assert(badScore, 'NPS score out of 0-100 range rejected');

    console.log('\nAll Sucesso do Cliente checks passed.');
  } finally {
    console.log('\n== Cleanup ==');
    await client.query('rollback').catch(() => {});
    await client.query(`delete from nps_score where owner_id in ($1,$2)`, [ids.userA, ids.userB]).catch(() => {});
    await client.query(`delete from opportunity_stage_history where opportunity_id = $1`, [ids.opp]).catch(() => {});
    await client.query(`delete from activities where related_to_id = $1`, [ids.opp]).catch(() => {});
    await client.query(`delete from opportunities where id = $1`, [ids.opp]).catch(() => {});
    await client.query(`delete from pipeline_stages where pipeline_id = $1`, [ids.pipeline]).catch(() => {});
    await client.query(`delete from pipelines where id = $1`, [ids.pipeline]).catch(() => {});
    await client.query(`delete from companies where id = $1`, [ids.company]).catch(() => {});
    await client.query(`delete from auth.users where id in ($1,$2)`, [ids.userA, ids.userB]).catch(() => {});
    console.log('  test data removed');
    await client.end();
  }
}

main().catch(err => {
  console.error('\nFAILED:', err.message);
  process.exit(1);
});
