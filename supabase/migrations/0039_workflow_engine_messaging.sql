-- Adendo — motor de Fluxos: liga a execução dos triggers/actions de
-- mensageria cujo vocabulário foi só declarado em 0038 (CHECK constraints),
-- sem nenhuma lógica de disparo/execução real ainda.
--
-- Fix crítico encontrado ao revisar o motor: get_related_owner() (0009) não
-- tem branch para related_to_type = 'conversation', mesmo esse valor já
-- sendo aceito por activities_related_to_type_check desde 0038. Sem esse
-- branch, is_own(get_related_owner('conversation', id)) sempre avalia NULL
-- (não FALSE) — RLS trata NULL como "não visível" — então uma activity de
-- conversa fica invisível até para o próprio dono do tenant. Corrigido aqui
-- antes de qualquer trigger de activity de mensageria ser criado (0040),
-- senão essas activities nasceriam invisíveis.
--
-- internal_config: execute_workflow_action() precisa chamar a edge function
-- send-conversation-message via pg_net para a ação send_message realmente
-- entregar a mensagem (mesmo padrão de net.http_post já usado por
-- call_webhook) — mas isso exige a URL base das edge functions + a service
-- role key, que não são segredos que uma migration deveria hardcodar. Essa
-- tabela singleton guarda essas duas chaves; fica vazia até o deploy real
-- popular (`update internal_config set value = '...' where key = '...'`).
-- Sem isso preenchido, a ação send_message falha com uma mensagem clara em
-- vez de silenciosamente não fazer nada.
begin;

-- ============ Fix: get_related_owner ganha o branch de conversation ============
create or replace function public.get_related_owner(p_related_to_type text, p_related_to_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select case p_related_to_type
    when 'company' then (select owner_id from public.companies where id = p_related_to_id)
    when 'contact' then (select owner_id from public.contacts where id = p_related_to_id)
    when 'opportunity' then (select owner_id from public.opportunities where id = p_related_to_id)
    when 'task' then (select owner_id from public.tasks where id = p_related_to_id)
    when 'conversation' then (select owner_id from public.conversations where id = p_related_to_id)
  end;
$$;

-- ============ internal_config: singleton de config interna (deploy-time) ============
create table public.internal_config (
  key    text primary key,
  value  text
);

insert into public.internal_config (key, value) values
  ('edge_functions_base_url', null),
  ('service_role_key', null);

alter table public.internal_config enable row level security;
-- RLS habilitada sem nenhuma policy = deny-all para todo mundo exceto o
-- dono da tabela (postgres) — mesmo padrão de api_rate_limit em 0013.
-- Só execute_workflow_action() (security definer) lê esses valores.

-- ============ execute_workflow_action: + send_message, add_tag, move_opportunity_stage ============
create or replace function public.execute_workflow_action(p_action public.workflow_action, p_context jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target uuid;
  v_title text;
  v_message text;
  v_due_at timestamptz;
  v_table text;
  v_field text;
  v_value text;
  v_url text;
  v_request_id bigint;
  v_conversation_id uuid;
  v_contact_id uuid;
  v_opportunity_id uuid;
  v_base_url text;
  v_service_key text;
  v_tag_id uuid;
  v_owner_id uuid;
  v_pipeline_id uuid;
  v_stage_id uuid;
begin
  if p_action.action_type = 'create_task' then
    v_target := public.resolve_target_user(p_action.config->>'owner', p_context);
    if v_target is null then
      return jsonb_build_object('action_id', p_action.id, 'action_type', p_action.action_type, 'success', false, 'message', 'could not resolve target owner');
    end if;
    v_title := public.render_template(p_action.config->>'title_template', p_context);
    v_due_at := case when p_action.config ? 'due_in_hours'
      then now() + make_interval(hours => (p_action.config->>'due_in_hours')::int)
      else null end;

    insert into public.tasks (title, owner_id, due_at, related_to_type, related_to_id)
    values (v_title, v_target, v_due_at, p_context->>'related_to_type', (p_context->>'related_to_id')::uuid);

    return jsonb_build_object('action_id', p_action.id, 'action_type', p_action.action_type, 'success', true, 'message', 'task created for ' || v_target);

  elsif p_action.action_type = 'notify_user' then
    v_target := public.resolve_target_user(p_action.config->>'target', p_context);
    if v_target is null then
      return jsonb_build_object('action_id', p_action.id, 'action_type', p_action.action_type, 'success', false, 'message', 'could not resolve target user');
    end if;
    v_message := public.render_template(p_action.config->>'message_template', p_context);

    insert into public.notification (user_id, title, body, related_to_type, related_to_id)
    values (v_target, coalesce(p_action.config->>'title', 'Notificação'), v_message, p_context->>'related_to_type', (p_context->>'related_to_id')::uuid);

    if p_action.config->>'channel' = 'email' then
      return jsonb_build_object('action_id', p_action.id, 'action_type', p_action.action_type, 'success', true,
        'message', 'in-app notification created; email channel is a stub (no provider wired yet)');
    end if;
    return jsonb_build_object('action_id', p_action.id, 'action_type', p_action.action_type, 'success', true, 'message', 'in-app notification created for ' || v_target);

  elsif p_action.action_type = 'update_field' then
    v_table := p_action.config->>'table';
    v_field := p_action.config->>'field';
    v_value := p_action.config->>'value';

    if not (
      (v_table = 'tasks' and v_field = 'status')
      or (v_table = 'opportunities' and v_field = 'owner_id')
    ) then
      return jsonb_build_object('action_id', p_action.id, 'action_type', p_action.action_type, 'success', false,
        'message', format('field %s.%s is not in the update_field allow-list', v_table, v_field));
    end if;

    execute format('update public.%I set %I = $1 where id = $2', v_table, v_field)
      using v_value, (p_context->>'related_to_id')::uuid;

    return jsonb_build_object('action_id', p_action.id, 'action_type', p_action.action_type, 'success', true,
      'message', format('%s.%s updated', v_table, v_field));

  elsif p_action.action_type = 'call_webhook' then
    v_url := p_action.config->>'url';
    if v_url is null then
      return jsonb_build_object('action_id', p_action.id, 'action_type', p_action.action_type, 'success', false, 'message', 'missing url in config');
    end if;

    select net.http_post(
      url := v_url,
      body := coalesce(p_action.config->'payload_template', p_context),
      headers := '{"Content-Type":"application/json"}'::jsonb
    ) into v_request_id;

    return jsonb_build_object('action_id', p_action.id, 'action_type', p_action.action_type, 'success', true,
      'message', 'webhook queued via pg_net, request_id=' || v_request_id);

  elsif p_action.action_type = 'send_message' then
    v_conversation_id := case when p_context->>'related_to_type' = 'conversation' then (p_context->>'related_to_id')::uuid else null end;
    if v_conversation_id is null then
      return jsonb_build_object('action_id', p_action.id, 'action_type', p_action.action_type, 'success', false, 'message', 'no conversation_id in trigger context');
    end if;

    select value into v_base_url from public.internal_config where key = 'edge_functions_base_url';
    select value into v_service_key from public.internal_config where key = 'service_role_key';
    if v_base_url is null or v_service_key is null then
      return jsonb_build_object('action_id', p_action.id, 'action_type', p_action.action_type, 'success', false,
        'message', 'internal_config.edge_functions_base_url/service_role_key not populated for this deploy');
    end if;

    v_message := public.render_template(p_action.config->>'message_template', p_context);

    select net.http_post(
      url := v_base_url || '/functions/v1/send-conversation-message',
      body := jsonb_build_object('conversation_id', v_conversation_id, 'content', v_message, 'source', 'workflow'),
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_service_key)
    ) into v_request_id;

    return jsonb_build_object('action_id', p_action.id, 'action_type', p_action.action_type, 'success', true,
      'message', 'send-conversation-message queued via pg_net, request_id=' || v_request_id);

  elsif p_action.action_type = 'add_tag' then
    v_contact_id := case
      when p_context->>'related_to_type' = 'contact' then (p_context->>'related_to_id')::uuid
      when p_context ? 'contact_id' then (p_context->>'contact_id')::uuid
      else null
    end;
    v_owner_id := (p_context->>'owner_id')::uuid;
    if v_contact_id is null then
      return jsonb_build_object('action_id', p_action.id, 'action_type', p_action.action_type, 'success', false, 'message', 'no contact_id in trigger context');
    end if;

    insert into public.tags (owner_id, name) values (v_owner_id, p_action.config->>'tag_name')
    on conflict (owner_id, name) do update set name = excluded.name
    returning id into v_tag_id;

    insert into public.contact_tags (contact_id, tag_id) values (v_contact_id, v_tag_id)
    on conflict (contact_id, tag_id) do nothing;

    return jsonb_build_object('action_id', p_action.id, 'action_type', p_action.action_type, 'success', true,
      'message', format('tag "%s" applied to contact %s', p_action.config->>'tag_name', v_contact_id));

  elsif p_action.action_type = 'move_opportunity_stage' then
    v_opportunity_id := case
      when p_context->>'related_to_type' = 'opportunity' then (p_context->>'related_to_id')::uuid
      when p_context ? 'opportunity_id' then (p_context->>'opportunity_id')::uuid
      else null
    end;
    if v_opportunity_id is null then
      return jsonb_build_object('action_id', p_action.id, 'action_type', p_action.action_type, 'success', false, 'message', 'no opportunity_id in trigger context (conversation may not be linked to a deal)');
    end if;

    select pipeline_id into v_pipeline_id from public.opportunities where id = v_opportunity_id;
    select id into v_stage_id from public.pipeline_stages where pipeline_id = v_pipeline_id and name = p_action.config->>'to_stage_name';
    if v_stage_id is null then
      return jsonb_build_object('action_id', p_action.id, 'action_type', p_action.action_type, 'success', false,
        'message', format('stage "%s" not found in this opportunity''s pipeline', p_action.config->>'to_stage_name'));
    end if;

    update public.opportunities set stage_id = v_stage_id where id = v_opportunity_id;

    return jsonb_build_object('action_id', p_action.id, 'action_type', p_action.action_type, 'success', true,
      'message', format('opportunity %s moved to stage "%s"', v_opportunity_id, p_action.config->>'to_stage_name'));
  end if;

  return jsonb_build_object('action_id', p_action.id, 'action_type', p_action.action_type, 'success', false, 'message', 'unknown action_type');
end;
$$;

-- ============ Event-driven wiring: message_received ============
-- Só inbound de contato dispara (mensagem de humano/IA do próprio tenant
-- não é "recebida"); nota interna também não (is_internal_note usa
-- direction='inbound' por convenção de schema — ver 0032 — mas não é uma
-- mensagem do contato de verdade).
create or replace function public.messages_run_workflows()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_id uuid;
  v_contact_id uuid;
  v_opportunity_id uuid;
  v_channel_id uuid;
begin
  if NEW.direction = 'inbound' and NEW.sender_type = 'contact' and not NEW.is_internal_note then
    select owner_id, contact_id, opportunity_id, channel_id
      into v_owner_id, v_contact_id, v_opportunity_id, v_channel_id
    from public.conversations where id = NEW.conversation_id;

    perform public.run_workflows_for_trigger('message_received', jsonb_build_object(
      'related_to_type', 'conversation',
      'related_to_id', NEW.conversation_id,
      'owner_id', v_owner_id,
      'contact_id', v_contact_id,
      'opportunity_id', v_opportunity_id,
      'channel_id', v_channel_id,
      'message_id', NEW.id,
      'message_content', NEW.content
    ), NEW.id::text);
  end if;
  return NEW;
end;
$$;

create trigger msg_2_run_workflows after insert on public.messages
  for each row execute function public.messages_run_workflows();

-- ============ Event-driven wiring: campaign_replied ============
create or replace function public.campaign_recipients_run_workflows()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_id uuid;
begin
  if TG_OP = 'UPDATE' and NEW.status = 'replied' and OLD.status is distinct from 'replied' then
    select owner_id into v_owner_id from public.campaigns where id = NEW.campaign_id;

    perform public.run_workflows_for_trigger('campaign_replied', jsonb_build_object(
      'related_to_type', 'contact',
      'related_to_id', NEW.contact_id,
      'owner_id', v_owner_id,
      'contact_id', NEW.contact_id,
      'campaign_id', NEW.campaign_id
    ), NEW.id::text);
  end if;
  return NEW;
end;
$$;

create trigger campaign_recipients_1_run_workflows after update on public.campaign_recipients
  for each row execute function public.campaign_recipients_run_workflows();

-- ============ Scheduled trigger: conversation_idle (pg_cron) ============
-- Sem evento de banco que marque "20h de silêncio" — mesmo raciocínio de
-- run_scheduled_workflows() (task_overdue): scan periódico com dedup_key
-- por conversation_id para não refirar a cada scan enquanto a conversa
-- seguir parada.
create or replace function public.run_conversation_idle_check()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  c record;
begin
  for c in
    select id, owner_id, contact_id, opportunity_id, channel_id, last_message_at
    from public.conversations
    where status = 'open'
      and last_message_at is not null
      and last_message_at < now() - interval '4 hours'
  loop
    perform public.run_workflows_for_trigger(
      'conversation_idle',
      jsonb_build_object(
        'related_to_type', 'conversation',
        'related_to_id', c.id,
        'owner_id', c.owner_id,
        'contact_id', c.contact_id,
        'opportunity_id', c.opportunity_id,
        'channel_id', c.channel_id,
        'idle_since', c.last_message_at
      ),
      c.id::text || ':' || to_char(date_trunc('day', now()), 'YYYY-MM-DD'),
      false
    );
  end loop;
end;
$$;

select cron.schedule('run-conversation-idle-check', '*/15 * * * *', $$select public.run_conversation_idle_check();$$);

commit;
