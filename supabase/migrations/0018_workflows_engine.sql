-- Module 8 — Workflows: execution engine.
--
-- Context convention: every context jsonb passed into run_workflows_for_trigger
-- MUST include related_to_type/related_to_id (what record this firing is
-- about) plus trigger-specific fields (owner_id, from_stage_id, to_stage_id,
-- days_overdue, ...). This lets execute_workflow_action stay generic across
-- all three trigger types instead of special-casing each one.
begin;

-- ============ get_team_manager ============
create or replace function public.get_team_manager(p_user_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select tm2.user_id
  from public.team_members tm1
  join public.team_members tm2 on tm2.team_id = tm1.team_id
  join public.users u on u.id = tm2.user_id
  join public.role r on r.id = u.role_id
  where tm1.user_id = p_user_id and r.name = 'Manager'
  limit 1;
$$;

-- ============ render_template: {{field}} substitution from context ============
create or replace function public.render_template(p_template text, p_context jsonb)
returns text
language plpgsql
immutable
as $$
declare
  result text := p_template;
  rec record;
begin
  if p_template is null then
    return null;
  end if;
  for rec in select * from jsonb_each_text(p_context) loop
    result := replace(result, '{{' || rec.key || '}}', coalesce(rec.value, ''));
  end loop;
  return result;
end;
$$;

-- ============ resolve_target_user: owner / manager_of_owner / fixed:<uuid> ============
create or replace function public.resolve_target_user(p_target text, p_context jsonb)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_owner_id uuid := (p_context->>'owner_id')::uuid;
begin
  if p_target = 'record_owner' then
    return v_owner_id;
  elsif p_target = 'manager_of_owner' then
    return public.get_team_manager(v_owner_id);
  elsif p_target like 'fixed:%' then
    return substring(p_target from 7)::uuid;
  end if;
  return null;
end;
$$;

-- ============ evaluate_workflow_conditions: AND of all rows, vacuously true if none ============
create or replace function public.evaluate_workflow_conditions(p_workflow_id uuid, p_context jsonb)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  cond record;
  ctx_val text;
  ctx_num numeric;
  cond_num numeric;
begin
  for cond in select * from public.workflow_condition where workflow_id = p_workflow_id loop
    ctx_val := p_context->>cond.field;
    if ctx_val is null then
      return false;
    end if;

    if cond.operator in ('gt', 'gte', 'lt', 'lte') then
      ctx_num := ctx_val::numeric;
      cond_num := (cond.value #>> '{}')::numeric;
      if cond.operator = 'gt' and not (ctx_num > cond_num) then return false; end if;
      if cond.operator = 'gte' and not (ctx_num >= cond_num) then return false; end if;
      if cond.operator = 'lt' and not (ctx_num < cond_num) then return false; end if;
      if cond.operator = 'lte' and not (ctx_num <= cond_num) then return false; end if;
    elsif cond.operator = 'eq' and ctx_val is distinct from (cond.value #>> '{}') then
      return false;
    elsif cond.operator = 'neq' and ctx_val is not distinct from (cond.value #>> '{}') then
      return false;
    end if;
  end loop;
  return true;
end;
$$;

-- ============ execute_workflow_action ============
-- SECURITY DEFINER: this is an autonomous system action, not bound by the
-- triggering user's own RLS scope (same reasoning as the Module 5 activity
-- triggers) — a Sales Rep moving their own deal can still trigger a
-- workflow that creates a task for their Manager, even though the rep
-- themself has no permission to assign tasks to others directly.
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
  end if;

  return jsonb_build_object('action_id', p_action.id, 'action_type', p_action.action_type, 'success', false, 'message', 'unknown action_type');
end;
$$;

-- ============ run_workflows_for_trigger ============
-- p_dedup_key: when set, a workflow only ever fires once per (workflow_id,
-- dedup_key) — required for task_overdue, which is polled repeatedly by
-- pg_cron and would otherwise refire every scan for as long as a task
-- stays overdue past the threshold.
-- p_log_skipped: event-driven triggers (stage change, new contact) log a
-- 'skipped' row when conditions don't match, for auditability. The
-- overdue-task scan does NOT (p_log_skipped=false) — most overdue tasks
-- simply haven't crossed the day threshold yet on any given scan, and
-- logging that every 15 minutes for every open task would be pure noise.
create or replace function public.run_workflows_for_trigger(p_trigger_type text, p_context jsonb, p_dedup_key text default null, p_log_skipped boolean default true)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  wf record;
  act public.workflow_action;
  results jsonb;
  action_result jsonb;
  overall_success boolean;
  context_with_dedup jsonb;
begin
  context_with_dedup := case when p_dedup_key is not null then p_context || jsonb_build_object('dedup_key', p_dedup_key) else p_context end;

  for wf in select * from public.workflow where trigger_type = p_trigger_type and is_active loop
    if p_dedup_key is not null and exists (
      select 1 from public.workflow_execution_log
      where workflow_id = wf.id and status = 'success' and trigger_context->>'dedup_key' = p_dedup_key
    ) then
      continue;
    end if;

    if not public.evaluate_workflow_conditions(wf.id, p_context) then
      if p_log_skipped then
        insert into public.workflow_execution_log (workflow_id, trigger_context, status)
        values (wf.id, context_with_dedup, 'skipped');
      end if;
      continue;
    end if;

    results := '[]'::jsonb;
    overall_success := true;

    for act in select * from public.workflow_action where workflow_id = wf.id order by display_order loop
      begin
        action_result := public.execute_workflow_action(act, p_context);
      exception when others then
        action_result := jsonb_build_object('action_id', act.id, 'action_type', act.action_type, 'success', false, 'message', sqlerrm);
      end;
      results := results || jsonb_build_array(action_result);
      if not (action_result->>'success')::boolean then
        overall_success := false;
      end if;
    end loop;

    insert into public.workflow_execution_log (workflow_id, trigger_context, status, action_results)
    values (wf.id, context_with_dedup, case when overall_success then 'success' else 'failed' end, results);
  end loop;
end;
$$;

-- ============ Event-driven trigger wiring ============
create or replace function public.opportunities_run_workflows()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if TG_OP = 'UPDATE' and NEW.stage_id <> OLD.stage_id then
    perform public.run_workflows_for_trigger('opportunity_stage_change', jsonb_build_object(
      'related_to_type', 'opportunity',
      'related_to_id', NEW.id,
      'opportunity_name', NEW.name,
      'from_stage_id', OLD.stage_id,
      'to_stage_id', NEW.stage_id,
      'pipeline_id', NEW.pipeline_id,
      'owner_id', NEW.owner_id
    ));
  end if;
  return NEW;
end;
$$;

create trigger opp_6_run_workflows
  after update on public.opportunities
  for each row execute function public.opportunities_run_workflows();

create or replace function public.contacts_run_workflows()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.run_workflows_for_trigger('contact_created', jsonb_build_object(
    'related_to_type', 'contact',
    'related_to_id', NEW.id,
    'first_name', NEW.first_name,
    'company_id', NEW.company_id,
    'owner_id', NEW.owner_id
  ));
  return NEW;
end;
$$;

create trigger contact_1_run_workflows
  after insert on public.contacts
  for each row execute function public.contacts_run_workflows();

-- ============ Scheduled trigger: task_overdue (pg_cron) ============
create or replace function public.run_scheduled_workflows()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  t record;
begin
  for t in
    select id, title, owner_id, due_at, floor(extract(epoch from (now() - due_at)) / 86400) as days_overdue
    from public.tasks
    where status = 'pending' and due_at is not null and due_at < now()
  loop
    perform public.run_workflows_for_trigger(
      'task_overdue',
      jsonb_build_object(
        'related_to_type', 'task',
        'related_to_id', t.id,
        'task_title', t.title,
        'owner_id', t.owner_id,
        'days_overdue', t.days_overdue
      ),
      t.id::text,
      false
    );
  end loop;
end;
$$;

select cron.schedule('run-scheduled-workflows', '*/15 * * * *', $$select public.run_scheduled_workflows();$$);

commit;
