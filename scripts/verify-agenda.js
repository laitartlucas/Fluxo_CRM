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
  ['userA', 'userB', 'apptSoon', 'apptFar', 'apptStandalone'].forEach(k => ids[k] = crypto.randomUUID());

  try {
    console.log('\n== Setup: two tenants ==');
    await client.query(`insert into auth.users(id, email) values ($1,'agenda.a@test.com'), ($2,'agenda.b@test.com')`, [ids.userA, ids.userB]);

    console.log('\n== 1. Create appointments for user A ==');
    // Due in 20 minutes, with a 30-minute reminder window -> reminder is already due now.
    await client.query(
      `insert into appointment(id, owner_id, title, start_at, reminder_minutes_before) values ($1,$2,'Ligação com cliente', now() + interval '20 minutes', 30)`,
      [ids.apptSoon, ids.userA]
    );
    // Due in 3 days -> reminder window not reached yet.
    await client.query(
      `insert into appointment(id, owner_id, title, start_at, reminder_minutes_before) values ($1,$2,'Reunião distante', now() + interval '3 days', 30)`,
      [ids.apptFar, ids.userA]
    );
    console.log('  2 appointments created for user A');

    console.log('\n== 2. RLS: user B cannot see user A\'s appointments ==');
    await client.query('begin');
    await client.query('set local role authenticated');
    await client.query(`set local request.jwt.claim.sub = '${ids.userB}'`);
    const bSees = await client.query(`select count(*) from appointment`);
    assert(bSees.rows[0].count === '0', 'user B sees zero appointments (all belong to user A)');
    await client.query('rollback');

    await client.query('begin');
    await client.query('set local role authenticated');
    await client.query(`set local request.jwt.claim.sub = '${ids.userA}'`);
    const aSees = await client.query(`select count(*) from appointment`);
    assert(aSees.rows[0].count === '2', 'user A sees her own 2 appointments');
    await client.query('rollback');

    console.log('\n== 3. Reminder job fires for the soon appointment, not the far one ==');
    await client.query(`select send_appointment_reminders()`);
    const notifSoon = await client.query(`select title, body from notification where user_id = $1 and related_to_id = $2`, [ids.userA, ids.apptSoon]);
    assert(notifSoon.rows.length === 1, 'reminder notification created for the appointment starting in 20 minutes');
    assert(notifSoon.rows[0].body.includes('Ligação com cliente'), `notification body mentions the appointment (got "${notifSoon.rows[0].body}")`);

    const notifFar = await client.query(`select id from notification where related_to_id = $1`, [ids.apptFar]);
    assert(notifFar.rows.length === 0, 'no reminder yet for the appointment 3 days out');

    const remindedAt = await client.query(`select reminded_at from appointment where id = $1`, [ids.apptSoon]);
    assert(remindedAt.rows[0].reminded_at !== null, 'reminded_at was stamped on the appointment');

    console.log('\n== 4. Running the reminder job again does NOT duplicate the notification ==');
    await client.query(`select send_appointment_reminders()`);
    await client.query(`select send_appointment_reminders()`);
    const notifCount = await client.query(`select count(*) from notification where related_to_id = $1`, [ids.apptSoon]);
    assert(notifCount.rows[0].count === '1', 'still exactly 1 notification after running the job multiple times');

    console.log('\n== 5. Daily digest: only fires for users with pending tasks ==');
    await client.query(`insert into tasks(title, owner_id, status, due_at) values
      ('Tarefa pendente', $1, 'pending', now() + interval '1 day'),
      ('Tarefa atrasada', $1, 'pending', now() - interval '1 day')`, [ids.userA]);
    await client.query(`select send_daily_task_digest()`);
    const digestA = await client.query(`select body from notification where user_id = $1 and title = 'Resumo do seu dia'`, [ids.userA]);
    assert(digestA.rows.length === 1, 'user A (has pending tasks) received the daily digest');
    assert(digestA.rows[0].body.includes('2 tarefa') && digestA.rows[0].body.includes('1 atrasada'), `digest mentions correct counts (got "${digestA.rows[0].body}")`);

    const digestB = await client.query(`select id from notification where user_id = $1 and title = 'Resumo do seu dia'`, [ids.userB]);
    assert(digestB.rows.length === 0, 'user B (no tasks at all) received NO digest — not spammed with an empty summary');

    console.log('\nAll Agenda checks passed.');
  } finally {
    console.log('\n== Cleanup ==');
    await client.query('rollback').catch(() => {});
    await client.query(`delete from notification where user_id in ($1,$2)`, [ids.userA, ids.userB]).catch(() => {});
    await client.query(`delete from tasks where owner_id in ($1,$2)`, [ids.userA, ids.userB]).catch(() => {});
    await client.query(`delete from appointment where owner_id in ($1,$2)`, [ids.userA, ids.userB]).catch(() => {});
    await client.query(`delete from auth.users where id in ($1,$2)`, [ids.userA, ids.userB]).catch(() => {});
    console.log('  test data removed');
    await client.end();
  }
}

main().catch(err => {
  console.error('\nFAILED:', err.message);
  process.exit(1);
});
