require('dotenv').config({ quiet: true });
const { Client } = require('pg');

function assert(cond, msg) {
  if (!cond) throw new Error('ASSERTION FAILED: ' + msg);
  console.log('  ok:', msg);
}

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();

  console.log('\n== 1. Schema inventory ==');
  const tables = await client.query(`
    select table_name from information_schema.tables
    where table_schema = 'public' order by table_name;
  `);
  const expected = ['activities','companies','contacts','opportunities','opportunity_contacts',
    'opportunity_stage_history','pipeline_stages','pipelines','tasks','teams','team_members','users'];
  const got = tables.rows.map(r => r.table_name).sort();
  assert(JSON.stringify(got) === JSON.stringify(expected.sort()), `all 12 tables present: ${got.join(', ')}`);

  console.log('\n== 2. Insert a coherent test dataset ==');
  await client.query('begin');
  try {
    const team = await client.query(`insert into teams(name) values ('Time Teste') returning id`);
    const teamId = team.rows[0].id;

    const owner = await client.query(`insert into users(email, full_name) values ('owner@test.com','Dono Teste') returning id`);
    const ownerId = owner.rows[0].id;
    await client.query(`insert into team_members(team_id, user_id) values ($1,$2)`, [teamId, ownerId]);

    const company = await client.query(`insert into companies(name, owner_id) values ('ACME Ltda',$1) returning id`, [ownerId]);
    const companyId = company.rows[0].id;

    const contact = await client.query(`insert into contacts(company_id, first_name, last_name, email, owner_id)
      values ($1,'Maria','Silva','maria@acme.com',$2) returning id`, [companyId, ownerId]);
    const contactId = contact.rows[0].id;

    const pipeline = await client.query(`insert into pipelines(name) values ('Vendas Novas') returning id`);
    const pipelineId = pipeline.rows[0].id;

    const stage1 = await client.query(`insert into pipeline_stages(pipeline_id,name,display_order,probability)
      values ($1,'Qualificação',1,20) returning id`, [pipelineId]);
    const stage2 = await client.query(`insert into pipeline_stages(pipeline_id,name,display_order,probability,is_won)
      values ($1,'Fechado Ganho',2,100,true) returning id`, [pipelineId]);

    const opp = await client.query(`insert into opportunities(name,pipeline_id,stage_id,company_id,primary_contact_id,owner_id,value)
      values ('Deal ACME',$1,$2,$3,$4,$5,15000) returning id, updated_at`,
      [pipelineId, stage1.rows[0].id, companyId, contactId, ownerId]);
    const oppId = opp.rows[0].id;

    await client.query(`insert into opportunity_contacts(opportunity_id, contact_id, role) values ($1,$2,'decision_maker')`, [oppId, contactId]);
    await client.query(`insert into opportunity_stage_history(opportunity_id, to_stage_id, changed_by) values ($1,$2,$3)`, [oppId, stage1.rows[0].id, ownerId]);

    const task = await client.query(`insert into tasks(title, owner_id, created_by, related_to_type, related_to_id)
      values ('Ligar para Maria',$1,$2,'opportunity',$3) returning id`, [ownerId, ownerId, oppId]);

    await client.query(`insert into activities(type, payload, actor_id, related_to_type, related_to_id)
      values ('note', '{"text":"Primeiro contato feito"}', $1, 'opportunity', $2)`, [ownerId, oppId]);

    console.log('  inserted: team, user, company, contact, pipeline, 2 stages, opportunity, opportunity_contacts, stage_history, task, activity');

    console.log('\n== 3. updated_at trigger ==');
    // now() is frozen for the whole transaction, so we can't observe wall-clock
    // drift here. Instead: try to forge an ancient updated_at on the UPDATE
    // itself and confirm the trigger overrides it with the transaction's now().
    const forged = await client.query(
      `update opportunities set value = 20000, updated_at = '2000-01-01' where id = $1 returning updated_at`, [oppId]);
    const txNow = await client.query(`select now() as now`);
    const forgedYear = forged.rows[0].updated_at.getFullYear();
    assert(forgedYear !== 2000, `trigger overwrote client-supplied updated_at (got year ${forgedYear}, not 2000)`);
    assert(Math.abs(forged.rows[0].updated_at.getTime() - txNow.rows[0].now.getTime()) < 5000,
      'overwritten updated_at matches transaction now()');

    console.log('\n== 4. Constraint checks ==');
    let failed = false;
    try {
      await client.query('savepoint sp1');
      await client.query(`insert into pipeline_stages(pipeline_id,name,display_order,is_won,is_lost) values ($1,'Bad',3,true,true)`, [pipelineId]);
    } catch (e) { failed = true; }
    await client.query('rollback to savepoint sp1');
    assert(failed, 'CHECK constraint blocks a stage being both is_won and is_lost');

    failed = false;
    try {
      await client.query('savepoint sp2');
      await client.query(`insert into opportunities(name,pipeline_id,stage_id,owner_id) values ('x',$1,$2,$3)`,
        ['00000000-0000-0000-0000-000000000000', stage1.rows[0].id, ownerId]);
    } catch (e) { failed = true; }
    await client.query('rollback to savepoint sp2');
    assert(failed, 'FK blocks opportunity with non-existent pipeline_id');

    failed = false;
    try {
      await client.query('savepoint sp3');
      await client.query(`insert into team_members(team_id, user_id) values ($1,$2)`, [teamId, ownerId]);
    } catch (e) { failed = true; }
    await client.query('rollback to savepoint sp3');
    assert(failed, 'UNIQUE blocks a user from belonging to a second team');

    failed = false;
    try {
      await client.query('savepoint sp4');
      await client.query(`update activities set type = 'hacked' where id is not null`);
    } catch (e) { failed = true; }
    if (!failed) {
      console.log('  note: activities UPDATE succeeded at DB level (expected — RLS blocking this is Module 5, not Module 1)');
      await client.query('rollback to savepoint sp4');
    }

    console.log('\n== 5. Soft delete + trigram search ==');
    await client.query(`update companies set deleted_at = now() where id = $1`, [companyId]);
    const stillThere = await client.query(`select id from companies where id = $1`, [companyId]);
    assert(stillThere.rows.length === 1, 'soft-deleted company row still physically exists (no RLS yet to hide it — that is Module 3)');

    const trgm = await client.query(`select id from companies where name % 'ACME Ldta' limit 1`);
    assert(trgm.rows.length === 1, 'pg_trgm fuzzy match finds "ACME Ltda" via "ACME Ldta" typo');

    console.log('\nAll Module 1 checks passed.');
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
