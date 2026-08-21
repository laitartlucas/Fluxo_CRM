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
  ['userA', 'userB', 'campaignInsta', 'campaignAds'].forEach(k => ids[k] = crypto.randomUUID());

  try {
    console.log('\n== Setup ==');
    await client.query(`insert into auth.users(id, email) values ($1,'mkt.a@test.com'), ($2,'mkt.b@test.com')`, [ids.userA, ids.userB]);

    console.log('\n== 1. Create campaigns + leads attributed to them ==');
    await client.query(`insert into campaign(id, owner_id, name, channel, goal, status) values ($1,$2,'Divulgação Instagram','instagram','Gerar leads qualificados','active')`, [ids.campaignInsta, ids.userA]);
    await client.query(`insert into campaign(id, owner_id, name, channel, goal, status) values ($1,$2,'Anúncios Google','anuncios','Aumentar alcance','paused')`, [ids.campaignAds, ids.userA]);

    await client.query(`insert into contacts(first_name, owner_id, source, campaign_id) values
      ('Lead 1',$1,'instagram',$2), ('Lead 2',$1,'instagram',$2), ('Lead 3',$1,'anuncios',$3), ('Lead 4',$1,'indicacao',null)`,
      [ids.userA, ids.campaignInsta, ids.campaignAds]);
    console.log('  2 campaigns + 4 contacts with sources created');

    console.log('\n== 2. RLS: user B sees none of it ==');
    await client.query('begin');
    await client.query('set local role authenticated');
    await client.query(`set local request.jwt.claim.sub = '${ids.userB}'`);
    const bCampaigns = await client.query(`select count(*) from campaign`);
    assert(bCampaigns.rows[0].count === '0', 'user B sees zero campaigns');
    await client.query('rollback');

    console.log('\n== 3. Leads per campaign (mirrors "leads gerados") ==');
    const perCampaign = await client.query(`
      select c.name, count(ct.id) as leads
      from campaign c left join contacts ct on ct.campaign_id = c.id
      where c.owner_id = $1 group by c.id, c.name order by c.name
    `, [ids.userA]);
    const insta = perCampaign.rows.find(r => r.name === 'Divulgação Instagram');
    const ads = perCampaign.rows.find(r => r.name === 'Anúncios Google');
    assert(insta.leads === '2', `Instagram campaign attributed 2 leads (got ${insta.leads})`);
    assert(ads.leads === '1', `Ads campaign attributed 1 lead (got ${ads.leads})`);

    console.log('\n== 4. Leads by source (mirrors "Leads por origem" bar chart) ==');
    const bySource = await client.query(`
      select source, count(*) as n from contacts where owner_id = $1 group by source order by n desc
    `, [ids.userA]);
    assert(bySource.rows[0].source === 'instagram' && bySource.rows[0].n === '2', 'instagram is the top source with 2 leads ("melhor canal")');

    console.log('\n== 5. Toggle campaign status (active <-> paused) ==');
    await client.query(`update campaign set status = 'paused' where id = $1`, [ids.campaignInsta]);
    const paused = await client.query(`select status from campaign where id = $1`, [ids.campaignInsta]);
    assert(paused.rows[0].status === 'paused', 'campaign toggled to paused');

    console.log('\n== 6. Campaign name uniqueness is per-tenant, not global ==');
    await client.query(`insert into campaign(owner_id, name, channel) values ($1,'Divulgação Instagram','instagram')`, [ids.userB]);
    const bCampaignCount = await client.query(`select count(*) from campaign where owner_id = $1`, [ids.userB]);
    assert(bCampaignCount.rows[0].count === '1', 'user B can use the SAME campaign name as user A (per-tenant uniqueness, not global)');

    let dupFailed = false;
    try {
      await client.query(`insert into campaign(owner_id, name, channel) values ($1,'Divulgação Instagram','anuncios')`, [ids.userA]);
    } catch (e) { dupFailed = true; }
    assert(dupFailed, 'duplicate campaign name WITHIN the same tenant is still rejected');

    console.log('\n== 7. Invalid channel/source rejected ==');
    let badChannel = false;
    try {
      await client.query(`insert into campaign(owner_id, name, channel) values ($1,'x','tiktok')`, [ids.userA]);
    } catch (e) { badChannel = true; }
    assert(badChannel, 'unknown channel value rejected');

    console.log('\nAll Marketing checks passed.');
  } finally {
    console.log('\n== Cleanup ==');
    await client.query('rollback').catch(() => {});
    await client.query(`delete from contacts where owner_id in ($1,$2)`, [ids.userA, ids.userB]).catch(() => {});
    await client.query(`delete from campaign where owner_id in ($1,$2)`, [ids.userA, ids.userB]).catch(() => {});
    await client.query(`delete from auth.users where id in ($1,$2)`, [ids.userA, ids.userB]).catch(() => {});
    console.log('  test data removed');
    await client.end();
  }
}

main().catch(err => {
  console.error('\nFAILED:', err.message);
  process.exit(1);
});
