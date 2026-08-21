-- Module: Multi-tenant retrofit ("CRM universal para mentoradas" pivot).
--
-- Product pivot: each mentee ("mentorada") gets her own fully isolated
-- account (1 person = 1 tenant, invite-only, no team/role concept inside a
-- tenant). This REVERSES the original single-org/no-workspace_id decision
-- from Module 1 — deliberate, confirmed with the user, not an oversight.
--
-- Because it's strictly 1 user = 1 tenant, there is no "own/team/all"
-- scope to resolve anymore — every domain row's owner_id IS the tenant
-- boundary. This lets the entire Module 3 RBAC engine (role/permission/
-- role_permission/teams/team_members/record_share, has_permission(),
-- is_visible_by_scope()) be deleted rather than adapted: replaced by one
-- trivial function, is_own(uuid).
--
-- Platform admin (you, running the product): can invite new tenants and
-- deactivate accounts, but does NOT bypass RLS on business data (companies/
-- contacts/opportunities/etc.) — a deliberate privacy stance, not a
-- limitation of the mechanism (is_own() alone gates every business table;
-- platform-admin bypass is wired ONLY into the users table policies).
begin;

-- ============ 1. Drop the old RBAC engine ============
drop trigger if exists prevent_role_escalation on public.users;
drop function if exists public.prevent_role_escalation();
-- CASCADE: every existing RLS policy still references these two functions.
-- 0021 (next migration, same deploy) drops-and-recreates every one of
-- those policies anyway, so letting the cascade take them out here first
-- is correct, not collateral damage.
drop function if exists public.has_permission(text, text) cascade;
drop function if exists public.is_visible_by_scope(uuid, text, text) cascade;
drop function if exists public.get_team_manager(uuid) cascade;

alter table public.users drop column if exists role_id;

drop table if exists public.role_permission cascade;
drop table if exists public.permission cascade;
drop table if exists public.role cascade;
drop table if exists public.record_share cascade;
drop table if exists public.team_members cascade;
drop table if exists public.teams cascade;

-- ============ 2. New identity: is_platform_admin + is_own() ============
alter table public.users add column is_platform_admin boolean not null default false;

-- The account that already exists becomes the first platform admin —
-- otherwise nobody could invite the first real tenant.
update public.users set is_platform_admin = true;

create or replace function public.is_own(p_owner_id uuid)
returns boolean
language sql
stable
as $$
  select p_owner_id = auth.uid();
$$;

create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select is_platform_admin from public.users where id = auth.uid()), false);
$$;

-- Guards is_platform_admin/is_active the same way prevent_role_escalation
-- used to guard role_id/is_active: a normal user editing her own profile
-- can't grant herself admin or flip her own active flag; a null auth.uid()
-- (service-role/backend context, e.g. invite-member deactivating someone)
-- is trusted and bypasses the guard, same reasoning as before.
create or replace function public.prevent_self_escalation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null and not public.is_platform_admin() then
    new.is_platform_admin := old.is_platform_admin;
    new.is_active := old.is_active;
  end if;
  return new;
end;
$$;

create trigger prevent_self_escalation before update on public.users
  for each row execute function public.prevent_self_escalation();

-- ============ 3. Tenant-owned config: pipelines ============
-- Pipelines/stages used to be shared, org-wide config. Now each mentee has
-- her own funnel ("nomeie as etapas do seu jeito").
alter table public.pipelines add column owner_id uuid references public.users(id);
update public.pipelines set owner_id = (select id from public.users where is_platform_admin limit 1) where owner_id is null;
alter table public.pipelines alter column owner_id set not null;

-- ============ 4. Tenant integrity on opportunities ============
-- Defense in depth: an opportunity's pipeline must belong to the SAME
-- tenant as the opportunity itself — RLS already stops a tenant from
-- seeing another tenant's pipeline_id, but this stops a blind-UUID
-- reference from silently cross-linking data if guessed.
create or replace function public.opportunities_validate_stage_transition()
returns trigger
language plpgsql
as $$
declare
  v_pipeline_owner uuid;
begin
  if TG_OP = 'INSERT' or NEW.pipeline_id <> OLD.pipeline_id or NEW.stage_id <> OLD.stage_id then
    if not exists (
      select 1 from public.pipeline_stages
      where id = NEW.stage_id and pipeline_id = NEW.pipeline_id
    ) then
      raise exception 'stage_id % does not belong to pipeline_id %', NEW.stage_id, NEW.pipeline_id;
    end if;

    select owner_id into v_pipeline_owner from public.pipelines where id = NEW.pipeline_id;
    if v_pipeline_owner is distinct from NEW.owner_id then
      raise exception 'pipeline_id % does not belong to the same tenant as this opportunity', NEW.pipeline_id;
    end if;
  end if;

  if TG_OP = 'UPDATE' and NEW.stage_id <> OLD.stage_id and OLD.status in ('won', 'lost') then
    raise exception 'cannot change stage of a closed opportunity (status=%); call reopen_opportunity() first', OLD.status;
  end if;

  return NEW;
end;
$$;

-- ============ 5. Workflows become tenant-owned too ============
alter table public.workflow add column owner_id uuid references public.users(id);
update public.workflow set owner_id = (select id from public.users where is_platform_admin limit 1) where owner_id is null;
alter table public.workflow alter column owner_id set not null;

alter table public.workflow_execution_log add column owner_id uuid references public.users(id);

-- 'manager_of_owner' no longer resolves to anything (no managers in a
-- solo-tenant model) — only the record owner herself, or an explicit fixed
-- user, are valid targets now.
create or replace function public.resolve_target_user(p_target text, p_context jsonb)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_target = 'record_owner' then
    return (p_context->>'owner_id')::uuid;
  elsif p_target like 'fixed:%' then
    return substring(p_target from 7)::uuid;
  end if;
  return null;
end;
$$;

-- Workflows only fire for the tenant that owns the triggering record —
-- otherwise every mentee's "task overdue" workflow would fire for every
-- other mentee's overdue tasks too.
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
  v_owner_id uuid := (p_context->>'owner_id')::uuid;
begin
  context_with_dedup := case when p_dedup_key is not null then p_context || jsonb_build_object('dedup_key', p_dedup_key) else p_context end;

  for wf in select * from public.workflow where trigger_type = p_trigger_type and owner_id = v_owner_id and is_active loop
    if p_dedup_key is not null and exists (
      select 1 from public.workflow_execution_log
      where workflow_id = wf.id and status = 'success' and trigger_context->>'dedup_key' = p_dedup_key
    ) then
      continue;
    end if;

    if not public.evaluate_workflow_conditions(wf.id, p_context) then
      if p_log_skipped then
        insert into public.workflow_execution_log (workflow_id, owner_id, trigger_context, status)
        values (wf.id, v_owner_id, context_with_dedup, 'skipped');
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

    insert into public.workflow_execution_log (workflow_id, owner_id, trigger_context, status, action_results)
    values (wf.id, v_owner_id, context_with_dedup, case when overall_success then 'success' else 'failed' end, results);
  end loop;
end;
$$;

commit;
