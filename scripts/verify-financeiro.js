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
  ['userA', 'userB', 'contactA', 'chargePending', 'chargeOverdue', 'chargeProposed', 'chargePendingNotDue'].forEach(k => ids[k] = crypto.randomUUID());

  try {
    console.log('\n== Setup ==');
    await client.query(`insert into auth.users(id, email) values ($1,'fin.a@test.com'), ($2,'fin.b@test.com')`, [ids.userA, ids.userB]);
    await client.query(`insert into contacts(id, first_name, owner_id) values ($1,'Cliente da A',$2)`, [ids.contactA, ids.userA]);

    console.log('\n== 1. Create charges with different statuses/due dates ==');
    await client.query(`insert into charge(id, owner_id, contact_id, description, value, due_date, payment_method, status)
      values ($1,$2,$3,'Mentoria agosto',500,current_date + 10,'pix','pending')`, [ids.chargePending, ids.userA, ids.contactA]);
    await client.query(`insert into charge(id, owner_id, contact_id, description, value, due_date, payment_method, status)
      values ($1,$2,$3,'Mentoria julho',500,current_date - 5,'pix','pending')`, [ids.chargeOverdue, ids.userA, ids.contactA]);
    await client.query(`insert into charge(id, owner_id, contact_id, description, value, due_date, payment_method, status)
      values ($1,$2,$3,'Pacote proposto',1500,current_date + 20,'boleto','proposed')`, [ids.chargeProposed, ids.userA, ids.contactA]);
    await client.query(`insert into charge(id, owner_id, contact_id, description, value, due_date, payment_method, status)
      values ($1,$2,$3,'Mentoria setembro',300,current_date + 15,'pix','pending')`, [ids.chargePendingNotDue, ids.userA, ids.contactA]);
    console.log('  4 charges created (soon-to-be-paid, overdue-pending, proposed, pending-not-due)');

    const paidAtCheck = await client.query(`select paid_at from charge where id = $1`, [ids.chargePending]);
    assert(paidAtCheck.rows[0].paid_at === null, 'a pending charge has paid_at = null');

    console.log('\n== 2. RLS: user B cannot see user A\'s charges ==');
    await client.query('begin');
    await client.query('set local role authenticated');
    await client.query(`set local request.jwt.claim.sub = '${ids.userB}'`);
    const bSees = await client.query(`select count(*) from charge`);
    assert(bSees.rows[0].count === '0', 'user B sees zero charges');
    await client.query('rollback');

    console.log('\n== 3. Marking a charge paid auto-stamps paid_at ==');
    await client.query(`update charge set status = 'paid' where id = $1`, [ids.chargePending]);
    const paidRow = await client.query(`select status, paid_at from charge where id = $1`, [ids.chargePending]);
    assert(paidRow.rows[0].status === 'paid' && paidRow.rows[0].paid_at !== null, 'status=paid and paid_at auto-populated');

    console.log('\n== 4. Un-marking a paid charge clears paid_at ==');
    await client.query(`update charge set status = 'pending' where id = $1`, [ids.chargePending]);
    const unpaidRow = await client.query(`select paid_at from charge where id = $1`, [ids.chargePending]);
    assert(unpaidRow.rows[0].paid_at === null, 'paid_at cleared when status leaves paid');
    await client.query(`update charge set status = 'paid' where id = $1`, [ids.chargePending]); // re-mark paid for stats test below

    console.log('\n== 5. Stat aggregation logic (mirrors the dashboard cards) ==');
    const stats = await client.query(`
      select
        coalesce(sum(value) filter (where status='paid' and date_trunc('month', paid_at) = date_trunc('month', now())), 0) as paid_this_month,
        coalesce(sum(value) filter (where status='pending' and due_date >= current_date), 0) as pending_not_due,
        coalesce(sum(value) filter (where status='pending' and due_date < current_date), 0) as overdue,
        coalesce(sum(value) filter (where status='proposed'), 0) as proposed
      from charge where owner_id = $1
    `, [ids.userA]);
    assert(Number(stats.rows[0].paid_this_month) === 500, `paid this month = 500 (got ${stats.rows[0].paid_this_month})`);
    assert(Number(stats.rows[0].pending_not_due) === 300, `pending not-yet-due = 300 (got ${stats.rows[0].pending_not_due})`);
    assert(Number(stats.rows[0].overdue) === 500, `overdue = 500 (got ${stats.rows[0].overdue})`);
    assert(Number(stats.rows[0].proposed) === 1500, `proposed = 1500 (got ${stats.rows[0].proposed})`);

    console.log('\n== 6. Invalid payment_method / negative value rejected ==');
    let badMethod = false;
    try {
      await client.query(`insert into charge(owner_id, contact_id, description, value, due_date, payment_method) values ($1,$2,'x',10,current_date,'crypto')`, [ids.userA, ids.contactA]);
    } catch (e) { badMethod = true; }
    assert(badMethod, 'unknown payment_method rejected');

    let badValue = false;
    try {
      await client.query(`insert into charge(owner_id, contact_id, description, value, due_date, payment_method) values ($1,$2,'x',-10,current_date,'pix')`, [ids.userA, ids.contactA]);
    } catch (e) { badValue = true; }
    assert(badValue, 'negative value rejected');

    console.log('\nAll Financeiro checks passed.');
  } finally {
    console.log('\n== Cleanup ==');
    await client.query('rollback').catch(() => {});
    await client.query(`delete from charge where owner_id in ($1,$2)`, [ids.userA, ids.userB]).catch(() => {});
    await client.query(`delete from contacts where owner_id in ($1,$2)`, [ids.userA, ids.userB]).catch(() => {});
    await client.query(`delete from auth.users where id in ($1,$2)`, [ids.userA, ids.userB]).catch(() => {});
    console.log('  test data removed');
    await client.end();
  }
}

main().catch(err => {
  console.error('\nFAILED:', err.message);
  process.exit(1);
});
