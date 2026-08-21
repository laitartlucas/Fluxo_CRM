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
  ['owner', 'owner2', 'pipeline', 'stage1', 'stage2', 'company', 'contact', 'opp', 'task', 'standaloneTask']
    .forEach(k => ids[k] = crypto.randomUUID());

  try {
    console.log('\n== Setup ==');
    await client.query('begin');
    await client.query(`insert into auth.users(id, email) values ($1,'owner5@test.com'), ($2,'owner5b@test.com')`, [ids.owner, ids.owner2]);
    const salesRepRole = await client.query(`select id from role where name = 'Sales Rep'`);
    await client.query(`update public.users set role_id = $1 where id in ($2,$3)`, [salesRepRole.rows[0].id, ids.owner, ids.owner2]);
    await client.query(`insert into pipelines(id, name) values ($1,'P5')`, [ids.pipeline]);
    await client.query(`insert into pipeline_stages(id, pipeline_id, name, display_order) values
      ($1,$3,'S1',1), ($2,$3,'S2',2)`, [ids.stage1, ids.stage2, ids.pipeline]);
    await client.query(`insert into companies(id, name, owner_id) values ($1,'Co5',$2)`, [ids.company, ids.owner]);
    await client.query(`insert into contacts(id, company_id, first_name, owner_id) values ($1,$2,'Fulano',$3)`, [ids.contact, ids.company, ids.owner]);
    await client.query(`insert into opportunities(id, name, pipeline_id, stage_id, company_id, owner_id, value)
      values ($1,'Opp5',$2,$3,$4,$5,1000)`, [ids.opp, ids.pipeline, ids.stage1, ids.company, ids.owner]);
    await client.query('commit');
    console.log('  fixtures created');

    console.log('\n== 1. INSERT already generated a stage_change activity ==');
    let r = await client.query(`select type, payload from activities where related_to_type='opportunity' and related_to_id=$1 and type='stage_change'`, [ids.opp]);
    assert(r.rows.length === 1, 'exactly one stage_change activity from the INSERT');
    assert(r.rows[0].payload.to_stage_name === 'S1', 'payload.to_stage_name = S1');
    assert(r.rows[0].payload.from_stage_id === null, 'payload.from_stage_id is null for the initial insert');

    console.log('\n== 2. Moving stage generates a second stage_change activity with from/to ==');
    await client.query(`update opportunities set stage_id = $1 where id = $2`, [ids.stage2, ids.opp]);
    r = await client.query(`select payload from activities where related_to_type='opportunity' and related_to_id=$1 and type='stage_change' order by created_at`, [ids.opp]);
    assert(r.rows.length === 2, 'now two stage_change activities total');
    assert(r.rows[1].payload.from_stage_name === 'S1' && r.rows[1].payload.to_stage_name === 'S2', 'second activity payload: from S1 to S2');

    console.log('\n== 3. Editing opportunity.value generates a field_update activity ==');
    await client.query(`update opportunities set value = 5000 where id = $1`, [ids.opp]);
    r = await client.query(`select payload from activities where related_to_type='opportunity' and related_to_id=$1 and type='field_update' and payload->>'field'='value'`, [ids.opp]);
    assert(r.rows.length === 1, 'field_update activity for value change exists');
    assert(Number(r.rows[0].payload.old_value) === 1000 && Number(r.rows[0].payload.new_value) === 5000, 'old_value=1000, new_value=5000');

    console.log('\n== 4. Editing opportunity.owner_id generates a field_update activity ==');
    await client.query(`update opportunities set owner_id = $1 where id = $2`, [ids.owner2, ids.opp]);
    r = await client.query(`select payload from activities where related_to_type='opportunity' and related_to_id=$1 and type='field_update' and payload->>'field'='owner_id'`, [ids.opp]);
    assert(r.rows.length === 1, 'field_update activity for owner_id change exists');
    await client.query(`update opportunities set owner_id = $1 where id = $2`, [ids.owner, ids.opp]); // revert for later steps

    console.log('\n== 5. Editing an unmonitored field (name) generates NO activity ==');
    const before = await client.query(`select count(*) from activities where related_to_type='opportunity' and related_to_id=$1`, [ids.opp]);
    await client.query(`update opportunities set name = 'Opp5 renamed' where id = $1`, [ids.opp]);
    const after = await client.query(`select count(*) from activities where related_to_type='opportunity' and related_to_id=$1`, [ids.opp]);
    assert(before.rows[0].count === after.rows[0].count, 'renaming the opportunity (unmonitored field) does not add any activity');

    console.log('\n== 6. Company owner_id change generates field_update activity ==');
    await client.query(`update companies set owner_id = $1 where id = $2`, [ids.owner2, ids.company]);
    r = await client.query(`select payload from activities where related_to_type='company' and related_to_id=$1 and type='field_update'`, [ids.company]);
    assert(r.rows.length === 1, 'company owner_id change logged');
    await client.query(`update companies set owner_id = $1 where id = $2`, [ids.owner, ids.company]);

    console.log('\n== 7. Contact owner_id change generates field_update activity ==');
    await client.query(`update contacts set owner_id = $1 where id = $2`, [ids.owner2, ids.contact]);
    r = await client.query(`select payload from activities where related_to_type='contact' and related_to_id=$1 and type='field_update'`, [ids.contact]);
    assert(r.rows.length === 1, 'contact owner_id change logged');

    console.log('\n== 8. Completing a related task logs activity on the OPPORTUNITY timeline + sets completed_at ==');
    await client.query(`insert into tasks(id, title, owner_id, related_to_type, related_to_id) values ($1,'Ligar pro cliente',$2,'opportunity',$3)`,
      [ids.task, ids.owner, ids.opp]);
    let taskRow = await client.query(`select completed_at from tasks where id = $1`, [ids.task]);
    assert(taskRow.rows[0].completed_at === null, 'new pending task has completed_at = null');
    await client.query(`update tasks set status = 'done' where id = $1`, [ids.task]);
    taskRow = await client.query(`select completed_at from tasks where id = $1`, [ids.task]);
    assert(taskRow.rows[0].completed_at !== null, 'completed_at auto-populated when status -> done');
    r = await client.query(`select payload from activities where related_to_type='opportunity' and related_to_id=$1 and type='task_completed'`, [ids.opp]);
    assert(r.rows.length === 1, 'task_completed activity logged on the OPPORTUNITY timeline (not the task itself), since the task is related to it');
    assert(r.rows[0].payload.title === 'Ligar pro cliente', 'payload carries the task title');

    console.log('\n== 9. Completing a standalone task (no related record) logs on its OWN timeline ==');
    await client.query(`insert into tasks(id, title, owner_id) values ($1,'Tarefa solta',$2)`, [ids.standaloneTask, ids.owner]);
    await client.query(`update tasks set status = 'done' where id = $1`, [ids.standaloneTask]);
    r = await client.query(`select payload from activities where related_to_type='task' and related_to_id=$1 and type='task_completed'`, [ids.standaloneTask]);
    assert(r.rows.length === 1, 'standalone task completion logs against its own id as related_to');

    console.log('\n== 10. Moving a task OUT of done clears completed_at ==');
    await client.query(`update tasks set status = 'pending' where id = $1`, [ids.task]);
    taskRow = await client.query(`select completed_at from tasks where id = $1`, [ids.task]);
    assert(taskRow.rows[0].completed_at === null, 'completed_at cleared when status leaves done');

    console.log('\n== 11. get_timeline() returns activities + tasks combined, ordered by date ==');
    const timeline = await client.query(`select * from get_timeline('opportunity', $1)`, [ids.opp]);
    assert(timeline.rows.length >= 5, `timeline has multiple entries (got ${timeline.rows.length})`);
    const kinds = new Set(timeline.rows.map(r => r.kind));
    assert(kinds.has('activity') && kinds.has('task'), 'timeline mixes both activities and tasks');
    const dates = timeline.rows.map(r => new Date(r.occurred_at).getTime());
    const sorted = [...dates].sort((a, b) => b - a);
    assert(JSON.stringify(dates) === JSON.stringify(sorted), 'timeline rows are ordered by occurred_at descending');

    console.log('\n== 12. Activities are append-only: non-admin UPDATE/DELETE denied by RLS (from Module 3) ==');
    await client.query('begin');
    await client.query('set local role authenticated');
    await client.query(`set local request.jwt.claim.sub = '${ids.owner}'`);
    const anyActivity = await client.query(`select id from activities where related_to_id = $1 limit 1`, [ids.opp]);
    const updAttempt = await client.query(`update activities set type = 'hacked' where id = $1`, [anyActivity.rows[0].id]);
    assert(updAttempt.rowCount === 0, 'a regular owner cannot UPDATE an activity (0 rows affected, RLS denies non-admin)');
    const delAttempt = await client.query(`delete from activities where id = $1`, [anyActivity.rows[0].id]);
    assert(delAttempt.rowCount === 0, 'a regular owner cannot DELETE an activity (0 rows affected, RLS denies non-admin)');
    await client.query('rollback');

    console.log('\nAll Module 5 checks passed.');
  } finally {
    console.log('\n== Cleanup ==');
    await client.query('rollback').catch(() => {});
    await client.query('delete from activities where related_to_id in ($1,$2,$3,$4)', [ids.opp, ids.company, ids.contact, ids.standaloneTask]).catch(() => {});
    await client.query('delete from tasks where id in ($1,$2)', [ids.task, ids.standaloneTask]).catch(() => {});
    await client.query('delete from opportunity_stage_history where opportunity_id = $1', [ids.opp]).catch(() => {});
    await client.query('delete from opportunities where id = $1', [ids.opp]).catch(() => {});
    await client.query('delete from contacts where id = $1', [ids.contact]).catch(() => {});
    await client.query('delete from companies where id = $1', [ids.company]).catch(() => {});
    await client.query('delete from pipeline_stages where pipeline_id = $1', [ids.pipeline]).catch(() => {});
    await client.query('delete from pipelines where id = $1', [ids.pipeline]).catch(() => {});
    await client.query('delete from auth.users where id in ($1,$2)', [ids.owner, ids.owner2]).catch(() => {});
    console.log('  test data removed');
    await client.end();
  }
}

main().catch(err => {
  console.error('\nFAILED:', err.message);
  process.exit(1);
});
