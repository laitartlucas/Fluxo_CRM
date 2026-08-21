-- Module 8 — Workflows: schema.
--
-- pg_cron drives the one trigger_type that has no natural DB event to hook
-- (task_overdue — nothing "happens" the moment a task becomes late, time
-- just passes), polling on a schedule. pg_net drives call_webhook and the
-- (stubbed) email channel, since Postgres has no native outbound HTTP.
-- opportunity_stage_change / contact_created are event-driven — ordinary
-- AFTER triggers, same pattern as every other trigger in this schema.
begin;

create extension if not exists pg_cron;
create extension if not exists pg_net;

create table public.workflow (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  is_active boolean not null default true,
  trigger_type text not null check (trigger_type in ('opportunity_stage_change', 'task_overdue', 'contact_created')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.workflow_condition (
  id uuid primary key default gen_random_uuid(),
  workflow_id uuid not null references public.workflow(id) on delete cascade,
  field text not null,
  operator text not null check (operator in ('eq', 'neq', 'gt', 'gte', 'lt', 'lte')),
  value jsonb not null,
  created_at timestamptz not null default now()
);

-- action config shapes (validated by execute_workflow_action, not by a
-- CHECK constraint — jsonb payload shape varies too much per action_type):
--   create_task:   {title_template, owner: 'record_owner'|'manager_of_owner'|'fixed:<uuid>', due_in_hours?}
--   notify_user:   {target: same enum as owner above, channel: 'in_app'|'email', message_template}
--   update_field:  {table, field, value} — table/field checked against a hardcoded allow-list
--   call_webhook:  {url, payload_template?}
create table public.workflow_action (
  id uuid primary key default gen_random_uuid(),
  workflow_id uuid not null references public.workflow(id) on delete cascade,
  action_type text not null check (action_type in ('create_task', 'notify_user', 'update_field', 'call_webhook')),
  config jsonb not null default '{}'::jsonb,
  display_order integer not null default 1,
  created_at timestamptz not null default now(),
  constraint workflow_action_order_uq unique (workflow_id, display_order)
);

create table public.workflow_execution_log (
  id uuid primary key default gen_random_uuid(),
  workflow_id uuid references public.workflow(id) on delete set null,
  triggered_at timestamptz not null default now(),
  trigger_context jsonb not null,
  status text not null check (status in ('success', 'failed', 'skipped')),
  action_results jsonb,
  error_message text
);

create table public.notification (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id),
  title text not null,
  body text,
  related_to_type text check (related_to_type in ('company', 'contact', 'opportunity', 'task')),
  related_to_id uuid,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index workflow_condition_workflow_id_idx on public.workflow_condition(workflow_id);
create index workflow_action_workflow_id_idx on public.workflow_action(workflow_id);
create index workflow_execution_log_workflow_id_idx on public.workflow_execution_log(workflow_id);
create index workflow_execution_log_triggered_at_idx on public.workflow_execution_log(triggered_at);
create index notification_user_id_idx on public.notification(user_id);

create trigger set_updated_at before update on public.workflow
  for each row execute function public.set_updated_at();

-- ============ Permission catalog: 'workflows' resource (Admin/Owner only) ============
insert into public.permission (resource, action, scope)
values ('workflows', 'select', 'all'), ('workflows', 'insert', 'all'),
       ('workflows', 'update', 'all'), ('workflows', 'delete', 'all');

insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
cross join public.permission p
where r.name in ('Owner', 'Admin') and p.resource = 'workflows';

-- ============ RLS ============
alter table public.workflow enable row level security;
alter table public.workflow_condition enable row level security;
alter table public.workflow_action enable row level security;
alter table public.workflow_execution_log enable row level security;
alter table public.notification enable row level security;

create policy workflow_all on public.workflow for all
  using (public.has_permission('workflows', 'select')) with check (public.has_permission('workflows', 'update'));

create policy workflow_condition_all on public.workflow_condition for all
  using (public.has_permission('workflows', 'select')) with check (public.has_permission('workflows', 'update'));

create policy workflow_action_all on public.workflow_action for all
  using (public.has_permission('workflows', 'select')) with check (public.has_permission('workflows', 'update'));

-- Execution log: read-only to clients (Admin/Owner), never written by them —
-- only the SECURITY DEFINER engine functions insert here.
create policy workflow_execution_log_select on public.workflow_execution_log
  for select using (public.has_permission('workflows', 'select'));

-- Notifications: strictly personal. No client insert/update/delete beyond
-- marking one's own as read.
create policy notification_select on public.notification
  for select using (user_id = auth.uid());

create policy notification_mark_read on public.notification
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

commit;
