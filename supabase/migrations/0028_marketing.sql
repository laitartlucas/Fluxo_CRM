-- Module: Marketing — campaigns + lead source tracking.
--
-- The mockup's Pipeline/Contatos screens already show a "source" chip per
-- contact/card ("card.source") that nothing in the schema backed yet —
-- adding it here is what makes "Leads por origem" computable at all.
begin;

alter table public.contacts add column source text check (source in ('instagram', 'indicacao', 'anuncios', 'site', 'whatsapp', 'outro'));

create table public.campaign (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.users(id),
  name text not null,
  channel text not null check (channel in ('instagram', 'indicacao', 'anuncios', 'site', 'whatsapp', 'outro')),
  goal text,
  status text not null default 'active' check (status in ('active', 'paused')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint campaign_owner_name_uq unique (owner_id, name)
);

-- Attributes a contact to the specific campaign that brought them in
-- (optional — a referral or walk-in has a source but no campaign).
alter table public.contacts add column campaign_id uuid references public.campaign(id) on delete set null;

create trigger set_updated_at before update on public.campaign
  for each row execute function public.set_updated_at();

alter table public.campaign enable row level security;

create policy campaign_all on public.campaign
  for all using (public.is_own(owner_id)) with check (public.is_own(owner_id));

alter publication supabase_realtime add table public.campaign;

commit;
