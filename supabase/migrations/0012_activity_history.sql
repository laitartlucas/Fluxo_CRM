-- Module 5 — Activity History: automatic, trigger-driven timeline.
--
-- All activity-generating triggers are SECURITY DEFINER (bypass RLS on the
-- INSERT into activities) because these are system-generated audit events,
-- not a user manually creating a note — the actor is recorded via
-- actor_id = auth.uid(), but the write itself doesn't go through the
-- activities_insert RLS policy (that policy is for manual/API-driven
-- inserts, e.g. a user adding a note).
--
-- Monitored fields (deliberately narrow, to avoid noise):
--   opportunities: owner_id, value
--   companies:     owner_id
--   contacts:      owner_id
begin;

-- ============ stage_change activities (extends the Module 4 trigger) ============
create or replace function public.opportunities_log_stage_history()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_from_name text;
  v_to_name text;
begin
  if TG_OP = 'INSERT' then
    insert into public.opportunity_stage_history (opportunity_id, from_stage_id, to_stage_id, changed_by)
    values (NEW.id, null, NEW.stage_id, auth.uid());

    select name into v_to_name from public.pipeline_stages where id = NEW.stage_id;
    insert into public.activities (type, payload, actor_id, related_to_type, related_to_id)
    values (
      'stage_change',
      jsonb_build_object('from_stage_id', null, 'from_stage_name', null, 'to_stage_id', NEW.stage_id, 'to_stage_name', v_to_name),
      auth.uid(), 'opportunity', NEW.id
    );

  elsif TG_OP = 'UPDATE' and NEW.stage_id <> OLD.stage_id then
    insert into public.opportunity_stage_history (opportunity_id, from_stage_id, to_stage_id, changed_by)
    values (NEW.id, OLD.stage_id, NEW.stage_id, auth.uid());

    select name into v_from_name from public.pipeline_stages where id = OLD.stage_id;
    select name into v_to_name from public.pipeline_stages where id = NEW.stage_id;
    insert into public.activities (type, payload, actor_id, related_to_type, related_to_id)
    values (
      'stage_change',
      jsonb_build_object('from_stage_id', OLD.stage_id, 'from_stage_name', v_from_name, 'to_stage_id', NEW.stage_id, 'to_stage_name', v_to_name),
      auth.uid(), 'opportunity', NEW.id
    );
  end if;
  return NEW;
end;
$$;
-- trigger opp_3_log_stage_history (created in Module 4) already points at
-- this function by name — CREATE OR REPLACE is enough, no need to recreate it.

-- ============ field_update activities: opportunities ============
create or replace function public.opportunities_log_field_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if NEW.owner_id is distinct from OLD.owner_id then
    insert into public.activities (type, payload, actor_id, related_to_type, related_to_id)
    values ('field_update', jsonb_build_object('field', 'owner_id', 'old_value', OLD.owner_id, 'new_value', NEW.owner_id), auth.uid(), 'opportunity', NEW.id);
  end if;
  if NEW.value is distinct from OLD.value then
    insert into public.activities (type, payload, actor_id, related_to_type, related_to_id)
    values ('field_update', jsonb_build_object('field', 'value', 'old_value', OLD.value, 'new_value', NEW.value), auth.uid(), 'opportunity', NEW.id);
  end if;
  return NEW;
end;
$$;

create trigger opp_4_log_field_changes
  after update on public.opportunities
  for each row execute function public.opportunities_log_field_changes();

-- ============ field_update activities: companies ============
create or replace function public.companies_log_field_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if NEW.owner_id is distinct from OLD.owner_id then
    insert into public.activities (type, payload, actor_id, related_to_type, related_to_id)
    values ('field_update', jsonb_build_object('field', 'owner_id', 'old_value', OLD.owner_id, 'new_value', NEW.owner_id), auth.uid(), 'company', NEW.id);
  end if;
  return NEW;
end;
$$;

create trigger company_log_field_changes
  after update on public.companies
  for each row execute function public.companies_log_field_changes();

-- ============ field_update activities: contacts ============
create or replace function public.contacts_log_field_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if NEW.owner_id is distinct from OLD.owner_id then
    insert into public.activities (type, payload, actor_id, related_to_type, related_to_id)
    values ('field_update', jsonb_build_object('field', 'owner_id', 'old_value', OLD.owner_id, 'new_value', NEW.owner_id), auth.uid(), 'contact', NEW.id);
  end if;
  return NEW;
end;
$$;

create trigger contact_log_field_changes
  after update on public.contacts
  for each row execute function public.contacts_log_field_changes();

-- ============ tasks: derive completed_at, log completion ============
create or replace function public.tasks_sync_completed_at()
returns trigger
language plpgsql
as $$
begin
  if NEW.status = 'done' and (TG_OP = 'INSERT' or OLD.status <> 'done') then
    NEW.completed_at := now();
  elsif TG_OP = 'UPDATE' and NEW.status <> 'done' and OLD.status = 'done' then
    NEW.completed_at := null;
  end if;
  return NEW;
end;
$$;

create trigger task_1_sync_completed_at
  before insert or update on public.tasks
  for each row execute function public.tasks_sync_completed_at();

-- Logged against the task's related record when it has one (so "task
-- completed" shows up on the deal/company/contact timeline), falling back
-- to the task's own id for standalone tasks.
create or replace function public.tasks_log_completion()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if TG_OP = 'UPDATE' and NEW.status = 'done' and OLD.status <> 'done' then
    insert into public.activities (type, payload, actor_id, related_to_type, related_to_id)
    values (
      'task_completed',
      jsonb_build_object('title', NEW.title),
      auth.uid(),
      coalesce(NEW.related_to_type, 'task'),
      coalesce(NEW.related_to_id, NEW.id)
    );
  end if;
  return NEW;
end;
$$;

create trigger task_2_log_completion
  after update on public.tasks
  for each row execute function public.tasks_log_completion();

-- ============ Consolidated timeline ============
-- SECURITY INVOKER (the default — no explicit clause needed): runs with
-- the caller's RLS, so a Sales Rep calling this for a record they can't
-- see just gets an empty result, same as querying activities/tasks directly.
create or replace function public.get_timeline(p_related_to_type text, p_related_to_id uuid)
returns table (
  kind text,
  id uuid,
  occurred_at timestamptz,
  activity_type text,
  title text,
  payload jsonb,
  actor_id uuid
)
language sql
stable
as $$
  select 'activity'::text as kind, a.id, a.created_at as occurred_at, a.type as activity_type,
    null::text as title, a.payload, a.actor_id
  from public.activities a
  where a.related_to_type = p_related_to_type and a.related_to_id = p_related_to_id

  union all

  select 'task'::text as kind, t.id, coalesce(t.completed_at, t.created_at) as occurred_at, t.status as activity_type,
    t.title, jsonb_build_object('due_at', t.due_at, 'status', t.status), t.owner_id as actor_id
  from public.tasks t
  where t.related_to_type = p_related_to_type and t.related_to_id = p_related_to_id

  order by occurred_at desc;
$$;

commit;
