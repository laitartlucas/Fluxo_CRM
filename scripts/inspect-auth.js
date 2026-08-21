require('dotenv').config({ quiet: true });
const { Client } = require('pg');

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();

  const cols = await client.query(`
    select column_name, data_type, is_nullable, column_default
    from information_schema.columns
    where table_schema = 'auth' and table_name = 'users'
    order by ordinal_position;
  `);
  console.log('auth.users columns:');
  cols.rows.forEach(r => console.log(` - ${r.column_name} (${r.data_type}) nullable=${r.is_nullable} default=${r.column_default || ''}`));

  const roles = await client.query(`select rolname from pg_roles where rolname like '%auth%' or rolname = 'postgres' order by rolname;`);
  console.log('\nRelevant roles:', roles.rows.map(r => r.rolname).join(', '));

  const currentUser = await client.query(`select current_user, session_user;`);
  console.log('\nConnected as:', currentUser.rows[0]);

  await client.end();
}

main().catch(err => { console.error('ERROR:', err.message); process.exit(1); });
