-- Domain identity tables. public.users is NOT yet linked to auth.users here
-- (that FK + the auth trigger are added in Module 2 — Authentication).
--
-- Team model: 1 user belongs to at most 1 team, enforced via unique(user_id)
-- on team_members. A user with no row in team_members has no team; per
-- product decision, their records are then visible only to themselves,
-- Admins and the Owner role (resolved later by RLS in Module 3).
begin;

create table public.users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  full_name text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.team_members (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  user_id uuid not null unique references public.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index team_members_team_id_idx on public.team_members(team_id);

commit;
