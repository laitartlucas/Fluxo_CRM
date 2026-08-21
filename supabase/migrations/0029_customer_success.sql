-- Module: Sucesso do Cliente — a lens over WON opportunities (they ARE the
-- "clients"), not a new customer entity. Adds a health classification that
-- auto-initializes to 'saudavel' the moment a deal is won (same
-- derive-on-transition pattern as status/closed_at), and a simple,
-- manually-updated NPS field (no survey system built — the mockup shows a
-- single static number, this is a place for the mentee to log her own
-- externally-run survey result, not a full NPS product).
begin;

alter table public.opportunities add column health text check (health in ('saudavel', 'atencao', 'risco'));

create or replace function public.opportunities_sync_health()
returns trigger
language plpgsql
as $$
begin
  if NEW.status = 'won' and NEW.health is null then
    NEW.health := 'saudavel';
  elsif NEW.status <> 'won' then
    NEW.health := null;
  end if;
  return NEW;
end;
$$;

create trigger opp_7_sync_health before insert or update on public.opportunities
  for each row execute function public.opportunities_sync_health();

create table public.nps_score (
  owner_id uuid primary key references public.users(id),
  score integer not null check (score between 0 and 100),
  survey_label text,
  updated_at timestamptz not null default now()
);

create trigger set_updated_at before update on public.nps_score
  for each row execute function public.set_updated_at();

alter table public.nps_score enable row level security;

create policy nps_score_all on public.nps_score
  for all using (public.is_own(owner_id)) with check (public.is_own(owner_id));

commit;
