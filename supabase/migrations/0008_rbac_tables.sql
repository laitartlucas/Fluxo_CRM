-- Module 3 — Permissions: catalog tables + seed.
--
-- permission = one granular capability tuple (resource, action, scope).
-- role_permission links a role to the permissions it holds. A role has at
-- most one scope per (resource, action) — the seed below never grants the
-- same role two different scopes for the same resource/action pair.
--
-- users.role_id is nullable: a freshly invited user (via the Module 2
-- auth trigger) has no role until an Admin assigns one. has_permission()
-- and is_visible_by_scope() must treat NULL role_id as "no access" —
-- fail closed, not fail open.
begin;

create table public.role (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now()
);

create table public.permission (
  id uuid primary key default gen_random_uuid(),
  resource text not null,
  action text not null,
  scope text not null check (scope in ('own', 'team', 'all')),
  created_at timestamptz not null default now(),
  constraint permission_resource_action_scope_uq unique (resource, action, scope)
);

create table public.role_permission (
  id uuid primary key default gen_random_uuid(),
  role_id uuid not null references public.role(id) on delete cascade,
  permission_id uuid not null references public.permission(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint role_permission_uq unique (role_id, permission_id)
);

alter table public.users
  add column role_id uuid references public.role(id);

create table public.record_share (
  id uuid primary key default gen_random_uuid(),
  resource_type text not null check (resource_type in ('company', 'contact', 'opportunity', 'task')),
  resource_id uuid not null,
  shared_with_user_id uuid not null references public.users(id) on delete cascade,
  granted_by uuid not null references public.users(id),
  created_at timestamptz not null default now(),
  constraint record_share_uq unique (resource_type, resource_id, shared_with_user_id)
);

create index role_permission_role_id_idx on public.role_permission(role_id);
create index role_permission_permission_id_idx on public.role_permission(permission_id);
create index users_role_id_idx on public.users(role_id);
create index record_share_resource_idx on public.record_share(resource_type, resource_id);
create index record_share_shared_with_idx on public.record_share(shared_with_user_id);

-- ============ Seed: system roles ============
insert into public.role (name) values
  ('Owner'), ('Admin'), ('Manager'), ('Sales Rep'), ('Read-only');

-- ============ Seed: permission catalog ============
-- companies / contacts / opportunities / tasks: select, insert, update at
-- own/team/all; delete (hard delete escape hatch) at all only.
-- activities: select, insert at own/team/all; update/delete at all only
-- (nobody but Admin/Owner may correct or remove a timeline entry).
insert into public.permission (resource, action, scope)
select resource, action, scope
from (values
  ('companies', 'select', 'own'), ('companies', 'select', 'team'), ('companies', 'select', 'all'),
  ('companies', 'insert', 'own'), ('companies', 'insert', 'team'), ('companies', 'insert', 'all'),
  ('companies', 'update', 'own'), ('companies', 'update', 'team'), ('companies', 'update', 'all'),
  ('companies', 'delete', 'all'),

  ('contacts', 'select', 'own'), ('contacts', 'select', 'team'), ('contacts', 'select', 'all'),
  ('contacts', 'insert', 'own'), ('contacts', 'insert', 'team'), ('contacts', 'insert', 'all'),
  ('contacts', 'update', 'own'), ('contacts', 'update', 'team'), ('contacts', 'update', 'all'),
  ('contacts', 'delete', 'all'),

  ('opportunities', 'select', 'own'), ('opportunities', 'select', 'team'), ('opportunities', 'select', 'all'),
  ('opportunities', 'insert', 'own'), ('opportunities', 'insert', 'team'), ('opportunities', 'insert', 'all'),
  ('opportunities', 'update', 'own'), ('opportunities', 'update', 'team'), ('opportunities', 'update', 'all'),
  ('opportunities', 'delete', 'all'),

  ('tasks', 'select', 'own'), ('tasks', 'select', 'team'), ('tasks', 'select', 'all'),
  ('tasks', 'insert', 'own'), ('tasks', 'insert', 'team'), ('tasks', 'insert', 'all'),
  ('tasks', 'update', 'own'), ('tasks', 'update', 'team'), ('tasks', 'update', 'all'),
  ('tasks', 'delete', 'all'),

  ('activities', 'select', 'own'), ('activities', 'select', 'team'), ('activities', 'select', 'all'),
  ('activities', 'insert', 'own'), ('activities', 'insert', 'team'), ('activities', 'insert', 'all'),
  ('activities', 'update', 'all'),
  ('activities', 'delete', 'all'),

  ('users', 'select', 'all'),
  ('users', 'update', 'own'), ('users', 'update', 'all'),
  ('users', 'update_role', 'all'),

  ('teams', 'select', 'all'),
  ('teams', 'insert', 'all'), ('teams', 'update', 'all'), ('teams', 'delete', 'all'),

  ('pipelines', 'select', 'all'),
  ('pipelines', 'insert', 'all'), ('pipelines', 'update', 'all'), ('pipelines', 'delete', 'all'),

  ('pipeline_stages', 'select', 'all'),
  ('pipeline_stages', 'insert', 'all'), ('pipeline_stages', 'update', 'all'), ('pipeline_stages', 'delete', 'all'),

  ('record_share', 'select', 'all'),
  ('record_share', 'delete', 'all')
) as t(resource, action, scope);

-- ============ Seed: role -> permission mapping ============
-- Owner and Admin: full access (scope='all') everywhere.
insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
cross join public.permission p
where r.name in ('Owner', 'Admin')
  and p.scope = 'all';

-- Manager: team scope on the core CRM objects, own scope for activity
-- inserts, read-all + self-edit on users/config tables.
insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on (
  (p.resource in ('companies', 'contacts', 'opportunities', 'tasks') and p.action in ('select', 'insert', 'update') and p.scope = 'team')
  or (p.resource = 'activities' and p.action = 'select' and p.scope = 'team')
  or (p.resource = 'activities' and p.action = 'insert' and p.scope = 'own')
  or (p.resource = 'users' and p.action = 'select' and p.scope = 'all')
  or (p.resource = 'users' and p.action = 'update' and p.scope = 'own')
  or (p.resource in ('teams', 'pipelines', 'pipeline_stages') and p.action = 'select' and p.scope = 'all')
)
where r.name = 'Manager';

-- Sales Rep: own scope on the core CRM objects, own scope for activity
-- inserts, read-all + self-edit on users/config tables.
insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on (
  (p.resource in ('companies', 'contacts', 'opportunities', 'tasks') and p.action in ('select', 'insert', 'update') and p.scope = 'own')
  or (p.resource = 'activities' and p.action in ('select', 'insert') and p.scope = 'own')
  or (p.resource = 'users' and p.action = 'select' and p.scope = 'all')
  or (p.resource = 'users' and p.action = 'update' and p.scope = 'own')
  or (p.resource in ('teams', 'pipelines', 'pipeline_stages') and p.action = 'select' and p.scope = 'all')
)
where r.name = 'Sales Rep';

-- Read-only: select-all everywhere, no writes at all (not even own profile).
insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on (
  p.action = 'select' and p.scope = 'all'
)
where r.name = 'Read-only';

commit;
