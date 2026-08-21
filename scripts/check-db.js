require('dotenv').config({ quiet: true });
const { Client } = require('pg');

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  const version = await client.query('select version()');
  console.log('Connected:', version.rows[0].version);

  const tables = await client.query(`
    select table_schema, table_name
    from information_schema.tables
    where table_schema = 'public'
    order by table_name;
  `);
  console.log('Tables in public schema:', tables.rows.length);
  tables.rows.forEach(r => console.log(' -', r.table_name));

  await client.end();
}

main().catch(err => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
