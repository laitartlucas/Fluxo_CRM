require('dotenv').config({ quiet: true });
const { Client } = require('pg');

function assert(cond, msg) {
  if (!cond) throw new Error('ASSERTION FAILED: ' + msg);
  console.log('  ok:', msg);
}

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  await client.query('begin');

  try {
    console.log('\n== Setup ==');
    const team = await client.query(`insert into teams(name) values ('Time B') returning id`);
    const teamId = team.rows[0].id;
    const owner = await client.query(`insert into users(email, full_name) values ('b@test.com','User B') returning id`);
    const ownerId = owner.rows[0].id;
    await client.query(`insert into team_members(team_id, user_id) values ($1,$2)`, [teamId, ownerId]);
    const company = await client.query(`insert into companies(name, owner_id) values ('Beta Co',$1) returning id`, [ownerId]);
    const companyId = company.rows[0].id;
    const contact = await client.query(`insert into contacts(company_id, first_name, owner_id) values ($1,'João',$2) returning id`, [companyId, ownerId]);
    const contactId = contact.rows[0].id;
    const pipeline = await client.query(`insert into pipelines(name) values ('Pipeline B') returning id`);
    const pipelineId = pipeline.rows[0].id;
    const stage = await client.query(`insert into pipeline_stages(pipeline_id,name,display_order) values ($1,'S1',1) returning id`, [pipelineId]);
    const stageId = stage.rows[0].id;
    const opp = await client.query(`insert into opportunities(name,pipeline_id,stage_id,company_id,primary_contact_id,owner_id)
      values ('Deal B',$1,$2,$3,$4,$5) returning id`, [pipelineId, stageId, companyId, contactId, ownerId]);
    const oppId = opp.rows[0].id;
    console.log('  base rows created');

    console.log('\n== pipeline_stages uniqueness ==');
    let failed = false;
    try {
      await client.query('savepoint sp');
      await client.query(`insert into pipeline_stages(pipeline_id,name,display_order) values ($1,'S2',1)`, [pipelineId]); // dup display_order
    } catch (e) { failed = true; }
    await client.query('rollback to savepoint sp');
    assert(failed, 'unique(pipeline_id, display_order) blocks duplicate order in same pipeline');

    failed = false;
    try {
      await client.query('savepoint sp');
      await client.query(`insert into pipeline_stages(pipeline_id,name,display_order) values ($1,'S1',2)`, [pipelineId]); // dup name
    } catch (e) { failed = true; }
    await client.query('rollback to savepoint sp');
    assert(failed, 'unique(pipeline_id, name) blocks duplicate stage name in same pipeline');

    console.log('\n== opportunity_contacts uniqueness ==');
    await client.query(`insert into opportunity_contacts(opportunity_id, contact_id) values ($1,$2)`, [oppId, contactId]);
    failed = false;
    try {
      await client.query('savepoint sp');
      await client.query(`insert into opportunity_contacts(opportunity_id, contact_id) values ($1,$2)`, [oppId, contactId]);
    } catch (e) { failed = true; }
    await client.query('rollback to savepoint sp');
    assert(failed, 'unique(opportunity_id, contact_id) blocks duplicate link');

    console.log('\n== tasks.related_to check constraint ==');
    failed = false;
    try {
      await client.query('savepoint sp');
      await client.query(`insert into tasks(title, owner_id, related_to_type) values ('bad',$1,'opportunity')`, [ownerId]); // type without id
    } catch (e) { failed = true; }
    await client.query('rollback to savepoint sp');
    assert(failed, 'tasks_related_to_both_or_neither blocks related_to_type without related_to_id');

    const okTask = await client.query(`insert into tasks(title, owner_id) values ('no relation',$1) returning id`, [ownerId]);
    assert(okTask.rows.length === 1, 'task with neither related_to_type nor related_to_id is allowed (standalone task)');

    console.log('\n== ON DELETE behaviors ==');
    await client.query(`delete from contacts where id = $1`, [contactId]);
    const oppAfterContactDelete = await client.query(`select primary_contact_id from opportunities where id = $1`, [oppId]);
    assert(oppAfterContactDelete.rows[0].primary_contact_id === null, 'opportunities.primary_contact_id set null when contact hard-deleted');

    await client.query(`delete from companies where id = $1`, [companyId]);
    const oppAfterCompanyDelete = await client.query(`select company_id from opportunities where id = $1`, [oppId]);
    assert(oppAfterCompanyDelete.rows[0].company_id === null, 'opportunities.company_id set null when company hard-deleted');

    const historyBefore = await client.query(`select count(*) from opportunity_stage_history where opportunity_id = $1`, [oppId]);
    await client.query(`insert into opportunity_stage_history(opportunity_id, to_stage_id) values ($1,$2)`, [oppId, stageId]);
    await client.query(`delete from opportunities where id = $1`, [oppId]);
    const historyAfter = await client.query(`select count(*) from opportunity_stage_history where opportunity_id = $1`, [oppId]);
    assert(historyAfter.rows[0].count === '0', 'opportunity_stage_history cascade-deleted when opportunity is hard-deleted');

    console.log('\n== team cascade ==');
    await client.query(`delete from teams where id = $1`, [teamId]);
    const membership = await client.query(`select count(*) from team_members where team_id = $1`, [teamId]);
    assert(membership.rows[0].count === '0', 'team_members cascade-deleted when team is deleted');

    console.log('\nAll additional Module 1 checks passed.');
  } finally {
    await client.query('rollback');
    console.log('\n(test data rolled back — database left empty)');
  }
  await client.end();
}

main().catch(err => {
  console.error('\nFAILED:', err.message);
  process.exit(1);
});
