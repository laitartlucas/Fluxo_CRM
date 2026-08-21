-- companies/contacts use soft delete via deleted_at. Module 3 RLS will
-- filter deleted_at is null on select for all roles; no hard-delete policy
-- is exposed to the app.
begin;

create table public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  domain text,
  phone text,
  address text,
  notes text,
  owner_id uuid not null references public.users(id),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete set null,
  first_name text not null,
  last_name text,
  email text,
  phone text,
  job_title text,
  notes text,
  owner_id uuid not null references public.users(id),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index companies_owner_id_idx on public.companies(owner_id);
create index companies_deleted_at_idx on public.companies(deleted_at) where deleted_at is null;
create index companies_name_trgm_idx on public.companies using gin (name gin_trgm_ops);

create index contacts_owner_id_idx on public.contacts(owner_id);
create index contacts_company_id_idx on public.contacts(company_id);
create index contacts_deleted_at_idx on public.contacts(deleted_at) where deleted_at is null;
create index contacts_email_idx on public.contacts(email);
create index contacts_name_trgm_idx on public.contacts using gin ((coalesce(first_name, '') || ' ' || coalesce(last_name, '')) gin_trgm_ops);

commit;
