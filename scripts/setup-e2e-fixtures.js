require('dotenv').config({ quiet: true });
const { Client } = require('pg');
const crypto = require('crypto');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const AUTH_BASE = `${SUPABASE_URL}/auth/v1`;

async function adminCreateUser(email, password) {
  const res = await fetch(`${AUTH_BASE}/admin/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`createUser failed: ${JSON.stringify(json)}`);
  return json;
}

async function main() {
  const db = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await db.connect();

  const email = 'e2e.frontend.test@example.com';
  const password = 'FrontendTest!Aa1234';

  const roles = await db.query(`select id, name from role`);
  const roleByName = Object.fromEntries(roles.rows.map(r => [r.name, r.id]));

  const user = await adminCreateUser(email, password);
  await db.query(`update public.users set role_id = $1 where id = $2`, [roleByName['Admin'], user.id]);

  const pipelineId = crypto.randomUUID();
  const stage1 = crypto.randomUUID();
  const stage2 = crypto.randomUUID();
  const stage3 = crypto.randomUUID();
  const companyId = crypto.randomUUID();

  await db.query(`insert into pipelines(id, name) values ($1,'Pipeline E2E')`, [pipelineId]);
  await db.query(`insert into pipeline_stages(id, pipeline_id, name, display_order, probability) values
    ($1,$4,'Qualificação',1,20), ($2,$4,'Proposta',2,50), ($3,$4,'Negociação',3,80)`,
    [stage1, stage2, stage3, pipelineId]);
  await db.query(`insert into companies(id, name, owner_id) values ($1,'Acme E2E',$2)`, [companyId, user.id]);

  for (let i = 1; i <= 3; i++) {
    await db.query(`insert into opportunities(name, pipeline_id, stage_id, company_id, owner_id, value)
      values ($1,$2,$3,$4,$5,$6)`, [`Deal E2E ${i}`, pipelineId, stage1, companyId, user.id, 1000 * i]);
  }

  console.log(JSON.stringify({ email, password, user_id: user.id, pipeline_id: pipelineId }, null, 2));
  await db.end();
}

main().catch(err => { console.error('FAILED:', err.message); process.exit(1); });
