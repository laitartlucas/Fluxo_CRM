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
  ['owner', 'pipelineA', 'pipelineB', 'stage1', 'stage2', 'stageWon', 'stageLost', 'stageOtherPipeline',
   'opp1', 'opp2', 'opp3']
    .forEach(k => ids[k] = crypto.randomUUID());

  try {
    console.log('\n== Setup ==');
    await client.query('begin');
    await client.query(`insert into auth.users(id, email) values ($1,'pipe.owner@test.com')`, [ids.owner]);

    await client.query(`insert into pipelines(id, name) values ($1,'Pipeline A'), ($2,'Pipeline B')`, [ids.pipelineA, ids.pipelineB]);
    await client.query(`insert into pipeline_stages(id, pipeline_id, name, display_order, probability) values
      ($1,$5,'Qualificação',1,10),
      ($2,$5,'Proposta',2,50),
      ($3,$5,'Fechado Ganho',3,100),
      ($4,$5,'Fechado Perdido',4,0)`,
      [ids.stage1, ids.stage2, ids.stageWon, ids.stageLost, ids.pipelineA]);
    await client.query(`update pipeline_stages set is_won = true where id = $1`, [ids.stageWon]);
    await client.query(`update pipeline_stages set is_lost = true where id = $1`, [ids.stageLost]);
    await client.query(`insert into pipeline_stages(id, pipeline_id, name, display_order) values ($1,$2,'Outro Pipeline Stage',1)`,
      [ids.stageOtherPipeline, ids.pipelineB]);
    await client.query('commit');
    console.log('  2 pipelines, 4 stages in Pipeline A (2 open, 1 won, 1 lost), 1 stage in Pipeline B');

    console.log('\n== 1. INSERT: stage must belong to the given pipeline ==');
    let failed = false;
    try {
      await client.query(`insert into opportunities(name, pipeline_id, stage_id, owner_id, value) values ('Bad', $1, $2, $3, 100)`,
        [ids.pipelineA, ids.stageOtherPipeline, ids.owner]);
    } catch (e) { failed = true; }
    assert(failed, 'inserting an opportunity with a stage from a different pipeline fails');

    console.log('\n== 2. INSERT into an open stage: status derived as open, closed_at null ==');
    let r = await client.query(`insert into opportunities(id, name, pipeline_id, stage_id, owner_id, value, expected_close_date)
      values ($1,'Opp 1',$2,$3,$4,10000, current_date) returning status, closed_at`,
      [ids.opp1, ids.pipelineA, ids.stage1, ids.owner]);
    assert(r.rows[0].status === 'open' && r.rows[0].closed_at === null, 'new opportunity in a non-terminal stage: status=open, closed_at=null');

    const initialHistory = await client.query(`select from_stage_id, to_stage_id from opportunity_stage_history where opportunity_id = $1`, [ids.opp1]);
    assert(initialHistory.rows.length === 1 && initialHistory.rows[0].from_stage_id === null && initialHistory.rows[0].to_stage_id === ids.stage1,
      'INSERT already logs an initial stage_history row (from=null, to=stage1)');

    console.log('\n== 3. UPDATE: moving stage within same pipeline works + logs history ==');
    await client.query(`update opportunities set stage_id = $1 where id = $2`, [ids.stage2, ids.opp1]);
    const hist2 = await client.query(`select count(*) from opportunity_stage_history where opportunity_id = $1`, [ids.opp1]);
    assert(hist2.rows[0].count === '2', 'moving stage1 -> stage2 added a second history row (total 2)');

    console.log('\n== 4. UPDATE: stage from another pipeline is rejected ==');
    failed = false;
    try {
      await client.query(`update opportunities set stage_id = $1, pipeline_id = $1 where id = $2`, [ids.stageOtherPipeline, ids.opp1]);
    } catch (e) { failed = true; }
    assert(failed, 'cannot move an opportunity to a stage_id that does not belong to its pipeline');

    console.log('\n== 5. Moving into an is_won stage auto-sets status + closed_at ==');
    const won = await client.query(`update opportunities set stage_id = $1 where id = $2 returning status, closed_at`, [ids.stageWon, ids.opp1]);
    assert(won.rows[0].status === 'won', 'status automatically becomes won');
    assert(won.rows[0].closed_at !== null, 'closed_at automatically populated');

    console.log('\n== 6. Cannot move a closed opportunity\'s stage directly ==');
    failed = false;
    let errMsg = '';
    try {
      await client.query(`update opportunities set stage_id = $1 where id = $2`, [ids.stage1, ids.opp1]);
    } catch (e) { failed = true; errMsg = e.message; }
    assert(failed, `direct stage change on a won opportunity is rejected (error: "${errMsg}")`);

    console.log('\n== 7. Direct status tampering (no stage change) is silently reverted ==');
    const tamper = await client.query(`update opportunities set status = 'open', closed_at = null where id = $1 returning status, closed_at`, [ids.opp1]);
    assert(tamper.rows[0].status === 'won', 'directly setting status=open without moving the stage is reverted back to won');
    assert(tamper.rows[0].closed_at !== null, 'closed_at was reverted too, not nulled out');

    console.log('\n== 8. reopen_opportunity() flips status back to open, logs an activity ==');
    await client.query(`select reopen_opportunity($1, 'cliente pediu para renegociar')`, [ids.opp1]);
    const reopened = await client.query(`select status, closed_at from opportunities where id = $1`, [ids.opp1]);
    assert(reopened.rows[0].status === 'open', 'status is open after reopen_opportunity()');
    assert(reopened.rows[0].closed_at === null, 'closed_at cleared after reopen_opportunity()');
    const activity = await client.query(`select type, payload from activities where related_to_id = $1 and type = 'opportunity_reopened'`, [ids.opp1]);
    assert(activity.rows.length === 1, 'reopen_opportunity() logged an activity');
    assert(activity.rows[0].payload.reason === 'cliente pediu para renegociar', 'activity payload records the reason');

    console.log('\n== 9. reopen_opportunity() rejects reopening an already-open opportunity ==');
    failed = false;
    try {
      await client.query(`select reopen_opportunity($1, 'x')`, [ids.opp1]);
    } catch (e) { failed = true; }
    assert(failed, 'reopen_opportunity() on an already-open opportunity raises an error');

    console.log('\n== 10. After reopen, a normal stage move works again ==');
    const movedAfterReopen = await client.query(`update opportunities set stage_id = $1 where id = $2 returning status`, [ids.stage2, ids.opp1]);
    assert(movedAfterReopen.rows[0].status === 'open', 'after reopen_opportunity(), moving to an open stage succeeds and status stays open');

    console.log('\n== 11. Moving into an is_lost stage ==');
    r = await client.query(`insert into opportunities(id, name, pipeline_id, stage_id, owner_id, value, expected_close_date)
      values ($1,'Opp 2',$2,$3,$4,5000, current_date) returning id`, [ids.opp2, ids.pipelineA, ids.stage1, ids.owner]);
    const lost = await client.query(`update opportunities set stage_id = $1 where id = $2 returning status, closed_at`, [ids.stageLost, ids.opp2]);
    assert(lost.rows[0].status === 'lost' && lost.rows[0].closed_at !== null, 'moving to is_lost stage sets status=lost + closed_at');

    console.log('\n== 12. Forecast view: weighted sum matches manual calculation ==');
    await client.query(`insert into opportunities(id, name, pipeline_id, stage_id, owner_id, value, expected_close_date)
      values ($1,'Opp 3',$2,$3,$4,20000, current_date)`, [ids.opp3, ids.pipelineA, ids.stage2, ids.owner]);
    // opp1: value 10000 now in stage2 (probability 50) => 5000
    // opp3: value 20000 in stage2 (probability 50) => 10000
    // opp2 excluded (status=lost, not open)
    const forecast = await client.query(`select sum(weighted_forecast) as total, sum(opportunity_count) as cnt
      from opportunity_forecast where owner_id = $1`, [ids.owner]);
    assert(Number(forecast.rows[0].total) === 15000, `forecast weighted total = 15000 (got ${forecast.rows[0].total})`);
    assert(Number(forecast.rows[0].cnt) === 2, `forecast counts exactly 2 open opportunities (got ${forecast.rows[0].cnt})`);

    console.log('\n== 13. Conversion view: stage1 -> stage2 conversion rate ==');
    const conv = await client.query(`select stage_name, display_order, reached_count, previous_stage_count, conversion_rate_pct
      from pipeline_stage_conversion where pipeline_id = $1 order by display_order`, [ids.pipelineA]);
    console.log('  conversion table:', conv.rows.map(r => `${r.stage_name}: reached=${r.reached_count} prev=${r.previous_stage_count} rate=${r.conversion_rate_pct}%`).join(' | '));
    assert(conv.rows.length === 4, 'conversion view returns all 4 stages of Pipeline A');
    const stage1Row = conv.rows.find(r => r.display_order === 1);
    // opp1 and opp2 both started at stage1 (Qualificação); opp3 was inserted
    // directly into stage2, so it never touched stage1.
    assert(Number(stage1Row.reached_count) === 2, `stage1 (Qualificação) reached by opp1+opp2 (got ${stage1Row.reached_count})`);

    console.log('\n== 14. Stage duration view returns non-null durations for completed transitions ==');
    const dur = await client.query(`select duration from opportunity_stage_duration where opportunity_id = $1 and duration is not null`, [ids.opp1]);
    assert(dur.rows.length > 0, 'opp1 has at least one stage transition with a measurable duration');

    console.log('\nAll Module 4 checks passed.');
  } finally {
    console.log('\n== Cleanup ==');
    await client.query('rollback').catch(() => {});
    await client.query('delete from opportunity_contacts where opportunity_id in ($1,$2,$3)', [ids.opp1, ids.opp2, ids.opp3]).catch(() => {});
    await client.query('delete from activities where related_to_id in ($1,$2,$3)', [ids.opp1, ids.opp2, ids.opp3]).catch(() => {});
    await client.query('delete from opportunity_stage_history where opportunity_id in ($1,$2,$3)', [ids.opp1, ids.opp2, ids.opp3]).catch(() => {});
    await client.query('delete from opportunities where id in ($1,$2,$3)', [ids.opp1, ids.opp2, ids.opp3]).catch(() => {});
    await client.query('delete from pipeline_stages where pipeline_id in ($1,$2)', [ids.pipelineA, ids.pipelineB]).catch(() => {});
    await client.query('delete from pipelines where id in ($1,$2)', [ids.pipelineA, ids.pipelineB]).catch(() => {});
    await client.query('delete from auth.users where id = $1', [ids.owner]).catch(() => {});
    console.log('  test data removed');
    await client.end();
  }
}

main().catch(err => {
  console.error('\nFAILED:', err.message);
  process.exit(1);
});
