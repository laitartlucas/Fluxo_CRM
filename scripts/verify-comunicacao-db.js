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
  ['userA', 'userB', 'pipeline', 'stage1', 'company', 'contactA', 'contactB', 'opp'].forEach(k => ids[k] = crypto.randomUUID());

  try {
    console.log('\n== Setup ==');
    await client.query(`insert into auth.users(id, email) values ($1,'com.a@test.com'), ($2,'com.b@test.com')`, [ids.userA, ids.userB]);
    await client.query(`insert into pipelines(id, name, owner_id) values ($1,'Pipeline Com A',$2)`, [ids.pipeline, ids.userA]);
    await client.query(`insert into pipeline_stages(id, pipeline_id, name, display_order) values ($1,$2,'Qualificação',1)`, [ids.stage1, ids.pipeline]);
    await client.query(`insert into companies(id, name, owner_id) values ($1,'Acme Com',$2)`, [ids.company, ids.userA]);
    await client.query(`insert into contacts(id, first_name, owner_id, company_id) values ($1,'Fulano',$2,$3)`, [ids.contactA, ids.userA, ids.company]);
    await client.query(`insert into contacts(id, first_name, owner_id) values ($1,'Beltrano',$2)`, [ids.contactB, ids.userB]);
    await client.query(`insert into opportunities(id, name, pipeline_id, stage_id, owner_id, value) values ($1,'Negócio A',$2,$3,$4,1000)`, [ids.opp, ids.pipeline, ids.stage1, ids.userA]);

    console.log('\n== 1. Channels ==');
    const chA = await client.query(`insert into channels(owner_id, type, provider, display_name, status) values ($1,'whatsapp','evolution_api','WhatsApp Principal','connected') returning id`, [ids.userA]);
    ids.channelA = chA.rows[0].id;
    let badProvider = false;
    try {
      await client.query(`insert into channels(owner_id, type, provider, display_name) values ($1,'whatsapp','instagram_graph_api','x')`, [ids.userA]);
    } catch (e) { badProvider = true; }
    assert(badProvider, 'type/provider mismatch (whatsapp + instagram_graph_api) rejected by CHECK constraint');

    console.log('\n== 2. Conversation auto-assign (no team/round-robin in solo-tenant model — always the owner) ==');
    const conv = await client.query(
      `insert into conversations(owner_id, channel_id, contact_id) values ($1,$2,$3) returning id, assigned_to`,
      [ids.userA, ids.channelA, ids.contactA]
    );
    ids.conversation = conv.rows[0].id;
    assert(conv.rows[0].assigned_to === ids.userA, 'new conversation auto-assigned to tenant owner');

    console.log('\n== 3. Tenant integrity: conversation cannot reference another tenant\'s channel/contact ==');
    let crossTenant = false;
    try {
      await client.query(`insert into conversations(owner_id, channel_id, contact_id) values ($1,$2,$3)`, [ids.userA, ids.channelA, ids.contactB]);
    } catch (e) { crossTenant = true; }
    assert(crossTenant, 'conversation referencing a contact from a different tenant is rejected');

    console.log('\n== 4. Messages: last_message_at bump + AI auto-pause on human send ==');
    await client.query(
      `insert into messages(conversation_id, direction, sender_type, content_type, content) values ($1,'inbound','contact','text','Oi, tudo bem?')`,
      [ids.conversation]
    );
    let convRow = await client.query(`select last_message_at, ai_paused from conversations where id = $1`, [ids.conversation]);
    assert(convRow.rows[0].last_message_at !== null, 'last_message_at set after inbound message');
    assert(convRow.rows[0].ai_paused === false, 'ai_paused still false — only a HUMAN outbound send should pause the AI');

    await client.query(
      `insert into messages(conversation_id, direction, sender_type, sender_id, content_type, content) values ($1,'outbound','human_agent',$2,'text','Oi! Tudo sim.')`,
      [ids.conversation, ids.userA]
    );
    convRow = await client.query(`select ai_paused from conversations where id = $1`, [ids.conversation]);
    assert(convRow.rows[0].ai_paused === true, 'ai_paused automatically set to true after a human agent sends a message');

    console.log('\n== 5. Internal notes can never be a real outbound send ==');
    let noteViolation = false;
    try {
      await client.query(
        `insert into messages(conversation_id, direction, sender_type, content_type, content, is_internal_note) values ($1,'outbound','human_agent','text','nota interna',true)`,
        [ids.conversation]
      );
    } catch (e) { noteViolation = true; }
    assert(noteViolation, 'is_internal_note=true with direction=outbound rejected by CHECK constraint');

    await client.query(
      `insert into messages(conversation_id, direction, sender_type, content_type, content, is_internal_note) values ($1,'inbound','human_agent','text','nota interna ok',true)`,
      [ids.conversation]
    );
    console.log('  ok: internal note with a non-outbound direction is accepted');

    console.log('\n== 6. Webhook idempotency (external_message_id) ==');
    const extId = 'evo-' + crypto.randomBytes(6).toString('hex');
    const payload = [ids.conversation, extId];
    await client.query(
      `insert into messages(conversation_id, direction, sender_type, content_type, content, external_message_id)
       values ($1,'inbound','contact','text','mensagem duplicada de webhook',$2)
       on conflict (external_message_id) do nothing`, payload
    );
    await client.query(
      `insert into messages(conversation_id, direction, sender_type, content_type, content, external_message_id)
       values ($1,'inbound','contact','text','mensagem duplicada de webhook',$2)
       on conflict (external_message_id) do nothing`, payload
    );
    const dupCount = await client.query(`select count(*) from messages where external_message_id = $1`, [extId]);
    assert(dupCount.rows[0].count === '1', 'sending the same webhook payload twice does not duplicate the message');

    console.log('\n== 7. RLS: tenant B sees none of tenant A\'s comunicação data ==');
    await client.query('begin');
    await client.query('set local role authenticated');
    await client.query(`set local request.jwt.claim.sub = '${ids.userB}'`);
    const bChannels = await client.query(`select count(*) from channels`);
    const bConversations = await client.query(`select count(*) from conversations`);
    const bMessages = await client.query(`select count(*) from messages`);
    assert(bChannels.rows[0].count === '0', 'tenant B sees zero channels from tenant A');
    assert(bConversations.rows[0].count === '0', 'tenant B sees zero conversations from tenant A');
    assert(bMessages.rows[0].count === '0', 'tenant B sees zero messages from tenant A (via conversation join)');
    await client.query('rollback');

    console.log('\n== 8. Tags: unique per tenant, not global ==');
    await client.query(`insert into tags(owner_id, name, color) values ($1,'VIP','#ff0000')`, [ids.userA]);
    await client.query(`insert into tags(owner_id, name, color) values ($1,'VIP','#00ff00')`, [ids.userB]);
    let dupTag = false;
    try {
      await client.query(`insert into tags(owner_id, name) values ($1,'VIP')`, [ids.userA]);
    } catch (e) { dupTag = true; }
    assert(dupTag, 'duplicate tag name WITHIN the same tenant rejected');
    console.log('  ok: same tag name across two different tenants is allowed');

    console.log('\n== 9. Contacts: lead_source + opted_out_at (LGPD) ==');
    await client.query(
      `update contacts set lead_source = 'instagram_ad', lead_source_detail = $2, opted_out_at = null where id = $1`,
      [ids.contactA, JSON.stringify({ utm_campaign: 'promo-verao' })]
    );
    await client.query(`update contacts set opted_out_at = now() where id = $1`, [ids.contactB]);
    const optedOut = await client.query(`select opted_out_at from contacts where id = $1`, [ids.contactB]);
    assert(optedOut.rows[0].opted_out_at !== null, 'opted_out_at recorded — campaign sending logic must exclude this contact');

    console.log('\n== 10. AI agent config: one default per tenant, one per channel ==');
    await client.query(`insert into ai_agent_configs(owner_id, name, system_prompt) values ($1,'Padrão','Você é a assistente de {nome_negocio}.')`, [ids.userA]);
    let dupDefault = false;
    try {
      await client.query(`insert into ai_agent_configs(owner_id, name, system_prompt) values ($1,'Padrão 2','outro prompt')`, [ids.userA]);
    } catch (e) { dupDefault = true; }
    assert(dupDefault, 'a second default (channel_id null) config for the same tenant is rejected');

    await client.query(`insert into ai_agent_configs(owner_id, channel_id, name, system_prompt) values ($1,$2,'WhatsApp específico','prompt do canal')`, [ids.userA, ids.channelA]);
    let dupChannelConfig = false;
    try {
      await client.query(`insert into ai_agent_configs(owner_id, channel_id, name, system_prompt) values ($1,$2,'outro','x')`, [ids.userA, ids.channelA]);
    } catch (e) { dupChannelConfig = true; }
    assert(dupChannelConfig, 'a second config for the same channel is rejected');

    console.log('\n== 11. Campaigns: tenant integrity across channel/template ==');
    const tmpl = await client.query(`insert into campaign_templates(owner_id, name, channel_id, body) values ($1,'Boas-vindas',$2,'Olá {{nome}}, tudo bem?') returning id`, [ids.userA, ids.channelA]);
    ids.template = tmpl.rows[0].id;
    const camp = await client.query(`insert into campaigns(owner_id, name, channel_id, template_id, audience_filter) values ($1,'Campanha Teste',$2,$3,$4) returning id`, [ids.userA, ids.channelA, ids.template, JSON.stringify({ tags: ['VIP'] })]);
    ids.campaign = camp.rows[0].id;

    let crossChannel = false;
    try {
      const chB = await client.query(`insert into channels(owner_id, type, provider, display_name) values ($1,'whatsapp','evolution_api','Canal B') returning id`, [ids.userB]);
      await client.query(`insert into campaigns(owner_id, name, channel_id) values ($1,'Cross tenant',$2)`, [ids.userA, chB.rows[0].id]);
    } catch (e) { crossChannel = true; }
    assert(crossChannel, 'campaign referencing another tenant\'s channel is rejected');

    console.log('\n== 12. Campaign audience must exclude opted-out contacts (query pattern the sending function relies on) ==');
    await client.query(`insert into contacts(owner_id, first_name, opted_out_at) values ($1,'Optou Fora', now())`, [ids.userA]);
    const audience = await client.query(`select count(*) from contacts where owner_id = $1 and opted_out_at is null`, [ids.userA]);
    const withOptOut = await client.query(`select count(*) from contacts where owner_id = $1`, [ids.userA]);
    assert(Number(audience.rows[0].count) < Number(withOptOut.rows[0].count), 'filtering opted_out_at is null removes at least one contact from the audience');

    console.log('\n== 13. Pipeline extension: next_action_at / next_action_note ==');
    await client.query(`update opportunities set next_action_at = now() + interval '2 days', next_action_note = 'Ligar para confirmar proposta' where id = $1`, [ids.opp]);
    const opp = await client.query(`select next_action_at, next_action_note from opportunities where id = $1`, [ids.opp]);
    assert(opp.rows[0].next_action_note === 'Ligar para confirmar proposta', 'next_action_note persisted on opportunities');

    console.log('\n== 14. Activities/notification accept "conversation"; workflow accepts new trigger/action types ==');
    await client.query(
      `insert into activities(type, payload, actor_id, related_to_type, related_to_id) values ('message_received','{}',$1,'conversation',$2)`,
      [ids.userA, ids.conversation]
    );
    await client.query(
      `insert into notification(user_id, title, related_to_type, related_to_id) values ($1,'Nova mensagem','conversation',$2)`,
      [ids.userA, ids.conversation]
    );
    await client.query(`insert into workflow(owner_id, name, trigger_type) values ($1,'Responder lead', 'message_received')`, [ids.userA]);
    console.log('  ok: new related_to_type/trigger_type values accepted');

    console.log('\nAll Comunicação DB checks passed.');
  } finally {
    console.log('\n== Cleanup ==');
    await client.query('rollback').catch(() => {});
    await client.query(`delete from workflow where owner_id in ($1,$2)`, [ids.userA, ids.userB]).catch(() => {});
    await client.query(`delete from notification where user_id in ($1,$2)`, [ids.userA, ids.userB]).catch(() => {});
    await client.query(`delete from activities where actor_id in ($1,$2)`, [ids.userA, ids.userB]).catch(() => {});
    await client.query(`delete from campaign_followup_rules where campaign_id = $1`, [ids.campaign]).catch(() => {});
    await client.query(`delete from campaign_recipients where campaign_id = $1`, [ids.campaign]).catch(() => {});
    await client.query(`delete from campaigns where owner_id in ($1,$2)`, [ids.userA, ids.userB]).catch(() => {});
    await client.query(`delete from campaign_templates where owner_id in ($1,$2)`, [ids.userA, ids.userB]).catch(() => {});
    await client.query(`delete from ai_knowledge_documents where ai_agent_config_id in (select id from ai_agent_configs where owner_id in ($1,$2))`, [ids.userA, ids.userB]).catch(() => {});
    await client.query(`delete from ai_agent_configs where owner_id in ($1,$2)`, [ids.userA, ids.userB]).catch(() => {});
    await client.query(`delete from contact_tags where tag_id in (select id from tags where owner_id in ($1,$2))`, [ids.userA, ids.userB]).catch(() => {});
    await client.query(`delete from tags where owner_id in ($1,$2)`, [ids.userA, ids.userB]).catch(() => {});
    await client.query(`delete from messages where conversation_id in (select id from conversations where owner_id in ($1,$2))`, [ids.userA, ids.userB]).catch(() => {});
    await client.query(`delete from conversations where owner_id in ($1,$2)`, [ids.userA, ids.userB]).catch(() => {});
    await client.query(`delete from channels where owner_id in ($1,$2)`, [ids.userA, ids.userB]).catch(() => {});
    await client.query(`delete from opportunities where owner_id in ($1,$2)`, [ids.userA, ids.userB]).catch(() => {});
    await client.query(`delete from contacts where owner_id in ($1,$2)`, [ids.userA, ids.userB]).catch(() => {});
    await client.query(`delete from companies where owner_id in ($1,$2)`, [ids.userA, ids.userB]).catch(() => {});
    await client.query(`delete from pipeline_stages where pipeline_id = $1`, [ids.pipeline]).catch(() => {});
    await client.query(`delete from pipelines where owner_id in ($1,$2)`, [ids.userA, ids.userB]).catch(() => {});
    await client.query(`delete from auth.users where id in ($1,$2)`, [ids.userA, ids.userB]).catch(() => {});
    console.log('  test data removed');
    await client.end();
  }
}

main().catch(err => {
  console.error('\nFAILED:', err.message);
  process.exit(1);
});
