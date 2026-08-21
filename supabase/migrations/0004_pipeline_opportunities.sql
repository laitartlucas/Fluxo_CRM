-- Multiple pipelines are supported (e.g. "New Business", "Renewal"), each
-- with its own ordered set of stages. Business rules (stage must belong to
-- the opportunity's pipeline, won/lost transitions, closed_at, stage
-- history logging) are NOT implemented here — that's Module 4. This
-- migration only lays down structure, constraints and indexes.
begin;

create table public.pipelines (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.pipeline_stages (
  id uuid primary key default gen_random_uuid(),
  pipeline_id uuid not null references public.pipelines(id) on delete cascade,
  name text not null,
  display_order integer not null,
  probability numeric(5,2) not null default 0 check (probability >= 0 and probability <= 100),
  is_won boolean not null default false,
  is_lost boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pipeline_stages_not_won_and_lost check (not (is_won and is_lost)),
  constraint pipeline_stages_pipeline_order_uq unique (pipeline_id, display_order),
  constraint pipeline_stages_pipeline_name_uq unique (pipeline_id, name)
);

create table public.opportunities (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  pipeline_id uuid not null references public.pipelines(id),
  stage_id uuid not null references public.pipeline_stages(id),
  company_id uuid references public.companies(id) on delete set null,
  primary_contact_id uuid references public.contacts(id) on delete set null,
  owner_id uuid not null references public.users(id),
  value numeric(14,2) not null default 0,
  currency text not null default 'BRL',
  status text not null default 'open' check (status in ('open', 'won', 'lost')),
  expected_close_date date,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.opportunity_stage_history (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references public.opportunities(id) on delete cascade,
  from_stage_id uuid references public.pipeline_stages(id),
  to_stage_id uuid not null references public.pipeline_stages(id),
  changed_by uuid references public.users(id),
  changed_at timestamptz not null default now(),
  note text
);

create table public.opportunity_contacts (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references public.opportunities(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  role text,
  created_at timestamptz not null default now(),
  constraint opportunity_contacts_uq unique (opportunity_id, contact_id)
);

create index pipeline_stages_pipeline_id_idx on public.pipeline_stages(pipeline_id);

create index opportunities_owner_id_idx on public.opportunities(owner_id);
create index opportunities_pipeline_stage_idx on public.opportunities(pipeline_id, stage_id);
create index opportunities_status_idx on public.opportunities(status);
create index opportunities_company_id_idx on public.opportunities(company_id);

create index opportunity_stage_history_opportunity_id_idx on public.opportunity_stage_history(opportunity_id);

create index opportunity_contacts_opportunity_id_idx on public.opportunity_contacts(opportunity_id);
create index opportunity_contacts_contact_id_idx on public.opportunity_contacts(contact_id);

commit;
