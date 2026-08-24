-- Dados de demonstração para 1 usuário (a "cliente" que vai ver o sistema
-- funcionando antes de fechar os 70 usuários simultâneos).
--
-- COMO RODAR: este script NÃO é aplicado automaticamente por `supabase db
-- push` (isso só roda migrations). Depois que a cliente já tiver criado a
-- própria conta (via convite/signup — precisa existir em auth.users/
-- public.users antes de rodar isto), execute este arquivo direto no projeto
-- Supabase Cloud:
--   - Dashboard → SQL Editor → cole o conteúdo e rode; ou
--   - `psql "<connection string do projeto>" -f supabase/seed_demo.sql`
--
-- Assume que existe exatamente 1 usuário em public.users (o primeiro criado
-- é o que recebe os dados). Se já existir mais de um, ajuste o filtro de
-- v_owner_id abaixo antes de rodar.
--
-- Não usa nenhuma credencial real de WhatsApp/Instagram — os canais aqui
-- são só registros visuais (status 'connected'/'pending_qr' pra tela Contas
-- não aparecer vazia), sem credential_ref de verdade. Não tente enviar
-- mensagem de verdade por eles.

begin;

do $$
declare
  v_owner_id uuid;
  v_pipeline_id uuid;
  v_stage_qualificacao uuid;
  v_stage_proposta uuid;
  v_stage_negociacao uuid;
  v_stage_ganho uuid;
  v_stage_perdido uuid;

  v_company_acme uuid;
  v_company_beta uuid;

  v_contact_joao uuid;
  v_contact_maria uuid;
  v_contact_pedro uuid;
  v_contact_ana uuid;
  v_contact_carla uuid;
  v_contact_lucas uuid;

  v_tag_quente uuid;
  v_tag_cliente uuid;
  v_tag_frio uuid;

  v_channel_whatsapp uuid;
  v_channel_instagram uuid;

  v_conv_joao uuid;
  v_conv_maria uuid;
  v_conv_pedro uuid;

  v_opp_beta uuid;

  v_ai_config uuid;

  v_template uuid;
  v_campaign uuid;
  v_campaign_recipient uuid;

  v_workflow uuid;
begin
  select id into v_owner_id from public.users order by created_at limit 1;
  if v_owner_id is null then
    raise exception 'Nenhum usuário encontrado em public.users — crie a conta da cliente antes de rodar este seed.';
  end if;

  select id into v_pipeline_id from public.pipelines where owner_id = v_owner_id order by created_at limit 1;
  if v_pipeline_id is null then
    raise exception 'Nenhum pipeline encontrado pro owner %  — o fluxo de convite/signup deveria ter criado um automaticamente.', v_owner_id;
  end if;

  select id into v_stage_qualificacao from public.pipeline_stages where pipeline_id = v_pipeline_id and name = 'Qualificação';
  select id into v_stage_proposta from public.pipeline_stages where pipeline_id = v_pipeline_id and name = 'Proposta';
  select id into v_stage_negociacao from public.pipeline_stages where pipeline_id = v_pipeline_id and name = 'Negociação';
  select id into v_stage_ganho from public.pipeline_stages where pipeline_id = v_pipeline_id and name = 'Fechado Ganho';
  select id into v_stage_perdido from public.pipeline_stages where pipeline_id = v_pipeline_id and name = 'Fechado Perdido';

  -- ============ Empresas ============
  insert into public.companies (name, domain, phone, owner_id) values
    ('Acme Consultoria', 'acmeconsultoria.com.br', '1140028922', v_owner_id) returning id into v_company_acme;
  insert into public.companies (name, domain, phone, owner_id) values
    ('Beta Distribuidora', 'betadist.com.br', '1140028933', v_owner_id) returning id into v_company_beta;

  -- ============ Contatos ============
  insert into public.contacts (first_name, last_name, email, phone, job_title, company_id, owner_id, lead_source) values
    ('João', 'Ferreira', 'joao.ferreira@acmeconsultoria.com.br', '5511987654321', 'Diretor Comercial', v_company_acme, v_owner_id, 'instagram_ad')
    returning id into v_contact_joao;
  insert into public.contacts (first_name, last_name, email, phone, job_title, company_id, owner_id, lead_source) values
    ('Maria', 'Souza', 'maria.souza@betadist.com.br', '5511976543210', 'Compradora', v_company_beta, v_owner_id, 'referral')
    returning id into v_contact_maria;
  insert into public.contacts (first_name, last_name, email, phone, owner_id, lead_source) values
    ('Pedro', 'Lima', 'pedro.lima@gmail.com', '5511965432109', v_owner_id, 'organic')
    returning id into v_contact_pedro;
  insert into public.contacts (first_name, last_name, email, phone, owner_id, lead_source) values
    ('Ana', 'Costa', 'ana.costa@gmail.com', '5511954321098', v_owner_id, 'site')
    returning id into v_contact_ana;
  insert into public.contacts (first_name, last_name, email, phone, owner_id, lead_source) values
    ('Carla', 'Nunes', 'carla.nunes@gmail.com', '5511943210987', v_owner_id, 'instagram_ad')
    returning id into v_contact_carla;
  insert into public.contacts (first_name, last_name, email, phone, owner_id, lead_source) values
    ('Lucas', 'Ramos', 'lucas.ramos@gmail.com', '5511932109876', v_owner_id, 'import')
    returning id into v_contact_lucas;

  -- ============ Tags ============
  insert into public.tags (owner_id, name, color) values (v_owner_id, 'quente', '#d8534e') returning id into v_tag_quente;
  insert into public.tags (owner_id, name, color) values (v_owner_id, 'cliente', '#1fa97a') returning id into v_tag_cliente;
  insert into public.tags (owner_id, name, color) values (v_owner_id, 'lead frio', '#6e6a63') returning id into v_tag_frio;

  insert into public.contact_tags (contact_id, tag_id) values
    (v_contact_joao, v_tag_quente),
    (v_contact_maria, v_tag_cliente),
    (v_contact_pedro, v_tag_frio),
    (v_contact_carla, v_tag_quente);

  -- ============ Oportunidades ============
  insert into public.opportunities (name, pipeline_id, stage_id, company_id, primary_contact_id, owner_id, value, expected_close_date) values
    ('Acme — Consultoria Q1', v_pipeline_id, v_stage_negociacao, v_company_acme, v_contact_joao, v_owner_id, 18500, current_date + 14);
  insert into public.opportunities (name, pipeline_id, stage_id, company_id, primary_contact_id, owner_id, value, expected_close_date) values
    ('Beta — Contrato Anual', v_pipeline_id, v_stage_proposta, v_company_beta, v_contact_maria, v_owner_id, 42000, current_date + 30)
    returning id into v_opp_beta;
  insert into public.opportunities (name, pipeline_id, stage_id, owner_id, value, expected_close_date) values
    ('Pedro Lima — Plano Starter', v_pipeline_id, v_stage_qualificacao, v_owner_id, 3600, current_date + 45);
  insert into public.opportunities (name, pipeline_id, stage_id, owner_id, value, expected_close_date) values
    ('Ana Costa — Upgrade Plano', v_pipeline_id, v_stage_qualificacao, v_owner_id, 5200, current_date + 20);
  insert into public.opportunities (name, pipeline_id, stage_id, owner_id, value, status, closed_at) values
    ('Carla Nunes — Plano Pro', v_pipeline_id, v_stage_ganho, v_owner_id, 7800, 'won', now() - interval '5 days');
  insert into public.opportunities (name, pipeline_id, stage_id, owner_id, value, status, closed_at) values
    ('Lucas Ramos — Consultoria Pontual', v_pipeline_id, v_stage_perdido, v_owner_id, 2400, 'lost', now() - interval '10 days');

  -- ============ Tarefas ============
  insert into public.tasks (title, owner_id, due_at, related_to_type, related_to_id) values
    ('Ligar pra João sobre a proposta', v_owner_id, now() + interval '1 day', 'contact', v_contact_joao);
  insert into public.tasks (title, owner_id, due_at, related_to_type, related_to_id) values
    ('Enviar contrato pra Beta Distribuidora', v_owner_id, now() - interval '1 day', 'opportunity', v_opp_beta);
  insert into public.tasks (title, owner_id, due_at) values
    ('Preparar apresentação mensal', v_owner_id, now() + interval '3 days');

  -- ============ Canais (visuais — sem credencial real) ============
  insert into public.channels (owner_id, type, provider, display_name, phone_number, status, quality_rating, is_sandbox, connected_at) values
    (v_owner_id, 'whatsapp', 'evolution_api', 'WhatsApp Comercial', '5511999998888', 'connected', 'green', true, now() - interval '20 days')
    returning id into v_channel_whatsapp;
  insert into public.channels (owner_id, type, provider, display_name, status, is_sandbox) values
    (v_owner_id, 'instagram', 'instagram_graph_api', 'Instagram @minhaempresa', 'pending_qr', true)
    returning id into v_channel_instagram;

  -- ============ Conversas + mensagens ============
  insert into public.conversations (owner_id, channel_id, contact_id, opportunity_id, status, last_message_at) values
    (v_owner_id, v_channel_whatsapp, v_contact_joao, null, 'open', now() - interval '2 hours')
    returning id into v_conv_joao;
  insert into public.conversations (owner_id, channel_id, contact_id, opportunity_id, status, last_message_at) values
    (v_owner_id, v_channel_whatsapp, v_contact_maria, v_opp_beta, 'open', now() - interval '6 hours')
    returning id into v_conv_maria;
  insert into public.conversations (owner_id, channel_id, contact_id, status, last_message_at) values
    (v_owner_id, v_channel_whatsapp, v_contact_pedro, 'pending', now() - interval '35 days')
    returning id into v_conv_pedro;

  -- Conversa do João: contato pergunta, IA responde rápido (demo de tempo de resposta da IA)
  insert into public.messages (conversation_id, direction, sender_type, content_type, content, sent_at) values
    (v_conv_joao, 'inbound', 'contact', 'text', 'Oi, vocês fazem consultoria pra empresa de porte médio?', now() - interval '2 hours 10 minutes');
  insert into public.messages (conversation_id, direction, sender_type, content_type, content, sent_at) values
    (v_conv_joao, 'outbound', 'ai_agent', 'text', 'Olá João! Sim, temos planos voltados pra empresas de porte médio. Posso te enviar os detalhes da proposta que preparamos pra Acme?', now() - interval '2 hours 8 minutes');
  insert into public.messages (conversation_id, direction, sender_type, content_type, content, sent_at) values
    (v_conv_joao, 'inbound', 'contact', 'text', 'Pode sim, manda por favor', now() - interval '2 hours');
  insert into public.messages (conversation_id, direction, sender_type, content_type, content, is_internal_note, sent_at) values
    (v_conv_joao, 'inbound', 'human_agent', 'text', 'Lembrar de mencionar o desconto de fechamento até dia 30.', true, now() - interval '1 hour 50 minutes');

  -- Conversa da Maria: negócio ativo vinculado (Beta), humano responde (demo de pausa automática da IA)
  insert into public.messages (conversation_id, direction, sender_type, content_type, content, sent_at) values
    (v_conv_maria, 'inbound', 'contact', 'text', 'Fechamos a reunião de terça? Preciso alinhar com o financeiro antes.', now() - interval '7 hours');
  insert into public.messages (conversation_id, direction, sender_type, content_type, content, sent_at) values
    (v_conv_maria, 'outbound', 'human_agent', 'text', 'Fechado, Maria! Terça às 10h, te mando o link da chamada mais tarde.', now() - interval '6 hours');

  -- Conversa do Pedro: mais antiga (fora dos últimos 30 dias) — alimenta o comparativo de período anterior no Dashboard
  insert into public.messages (conversation_id, direction, sender_type, content_type, content, sent_at) values
    (v_conv_pedro, 'inbound', 'contact', 'text', 'Vi o anúncio de vocês, qual o valor do plano starter?', now() - interval '40 days');
  insert into public.messages (conversation_id, direction, sender_type, content_type, content, sent_at) values
    (v_conv_pedro, 'outbound', 'ai_agent', 'text', 'Oi Pedro! O plano Starter sai por R$300/mês. Quer que eu te envie o link de contratação?', now() - interval '39 days 22 hours');

  -- ============ Atendente IA ============
  insert into public.ai_agent_configs (owner_id, channel_id, name, system_prompt, variables, business_hours, off_hours_message) values
    (v_owner_id, null, 'Atendimento padrão', 'Você é a assistente de atendimento de {nome_negocio}. Responda de forma cordial, objetiva, e ofereça ajuda com {produtos}.',
     '{"nome_negocio": "Minha Empresa", "produtos": "consultoria e planos de assinatura"}'::jsonb,
     '{"seg-sex": "08:00-18:00"}'::jsonb,
     'Olá! No momento estamos fora do horário de atendimento (seg-sex, 08h-18h). Retornamos assim que possível.')
    returning id into v_ai_config;

  -- ============ Disparos ============
  insert into public.campaign_templates (owner_id, name, channel_id, body, status) values
    (v_owner_id, 'Reativação de leads frios', v_channel_whatsapp, 'Oi {{nome}}, faz um tempo que não conversamos! Ainda tem interesse em conhecer nossos planos?', 'approved')
    returning id into v_template;

  insert into public.campaigns (owner_id, name, channel_id, template_id, audience_filter, status, created_by) values
    (v_owner_id, 'Reativação — leads frios Q1', v_channel_whatsapp, v_template, jsonb_build_object('tags', jsonb_build_array(v_tag_frio)), 'sending', v_owner_id)
    returning id into v_campaign;

  insert into public.campaign_recipients (campaign_id, contact_id, status, sent_at, replied_at) values
    (v_campaign, v_contact_pedro, 'replied', now() - interval '3 days', now() - interval '2 days');
  insert into public.campaign_recipients (campaign_id, contact_id, status, sent_at) values
    (v_campaign, v_contact_lucas, 'delivered', now() - interval '3 days')
    returning id into v_campaign_recipient;

  insert into public.campaign_followup_rules (campaign_id, wait_hours, message_template_id, stop_on_reply) values
    (v_campaign, 48, v_template, true);

  -- ============ Fluxos ============
  insert into public.workflow (owner_id, name, trigger_type, is_active) values
    (v_owner_id, 'Avisar quando negócio parar de responder', 'conversation_idle', true)
    returning id into v_workflow;

  insert into public.workflow_action (workflow_id, action_type, config, display_order) values
    (v_workflow, 'notify_user', jsonb_build_object('target', 'record_owner', 'channel', 'in_app', 'message_template', 'Conversa parada há um tempo, dá uma olhada.'), 1);

  insert into public.workflow_execution_log (workflow_id, owner_id, trigger_context, status, action_results) values
    (v_workflow, v_owner_id, jsonb_build_object('related_to_type', 'conversation', 'related_to_id', v_conv_pedro), 'success',
     jsonb_build_array(jsonb_build_object('action_id', gen_random_uuid(), 'action_type', 'notify_user', 'success', true, 'message', 'in-app notification created for ' || v_owner_id)));

  -- ============ Ajustes (branding + custo por mensagem, pro card do Dashboard aparecer preenchido) ============
  insert into public.tenant_settings (owner_id, brand_name, brand_primary_color, default_business_hours, cost_per_message) values
    (v_owner_id, 'Minha Empresa', '#5b50e6', '{"seg-sex": "08:00-18:00"}'::jsonb, 0.05)
  on conflict (owner_id) do update set
    brand_name = excluded.brand_name, brand_primary_color = excluded.brand_primary_color,
    default_business_hours = excluded.default_business_hours, cost_per_message = excluded.cost_per_message;

  raise notice 'Seed de demo aplicado pro owner_id = %', v_owner_id;
end $$;

commit;
