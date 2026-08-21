-- tasks: owner_id is the assignee, created_by is who created/assigned the
-- task (may differ, e.g. a manager assigning to a rep, or a future
-- workflow engine creating it on someone's behalf).
--
-- activities: append-only polymorphic timeline via related_to_type/
-- related_to_id. No updated_at, no update trigger — nothing should ever
-- mutate a row here (enforced by RLS in Module 5).
begin;

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  due_at timestamptz,
  status text not null default 'pending' check (status in ('pending', 'in_progress', 'done', 'cancelled')),
  owner_id uuid not null references public.users(id),
  created_by uuid references public.users(id),
  related_to_type text check (related_to_type in ('company', 'contact', 'opportunity')),
  related_to_id uuid,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tasks_related_to_both_or_neither check (
    (related_to_type is null and related_to_id is null) or
    (related_to_type is not null and related_to_id is not null)
  )
);

create table public.activities (
  id uuid primary key default gen_random_uuid(),
  type text not null,
  payload jsonb not null default '{}'::jsonb,
  actor_id uuid references public.users(id),
  related_to_type text not null check (related_to_type in ('company', 'contact', 'opportunity', 'task')),
  related_to_id uuid not null,
  created_at timestamptz not null default now()
);

create index tasks_owner_id_idx on public.tasks(owner_id);
create index tasks_status_idx on public.tasks(status);
create index tasks_due_at_idx on public.tasks(due_at);
create index tasks_related_to_idx on public.tasks(related_to_type, related_to_id);

create index activities_related_to_idx on public.activities(related_to_type, related_to_id);
create index activities_actor_id_idx on public.activities(actor_id);
create index activities_created_at_idx on public.activities(created_at);

commit;
