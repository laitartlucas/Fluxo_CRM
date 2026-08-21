-- Generic updated_at trigger, applied to every table that has the column.
-- team_members and the append-only tables (activities, opportunity_stage_history,
-- opportunity_contacts) intentionally have no updated_at / no trigger.
begin;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger set_updated_at before update on public.users
  for each row execute function public.set_updated_at();

create trigger set_updated_at before update on public.teams
  for each row execute function public.set_updated_at();

create trigger set_updated_at before update on public.companies
  for each row execute function public.set_updated_at();

create trigger set_updated_at before update on public.contacts
  for each row execute function public.set_updated_at();

create trigger set_updated_at before update on public.pipelines
  for each row execute function public.set_updated_at();

create trigger set_updated_at before update on public.pipeline_stages
  for each row execute function public.set_updated_at();

create trigger set_updated_at before update on public.opportunities
  for each row execute function public.set_updated_at();

create trigger set_updated_at before update on public.tasks
  for each row execute function public.set_updated_at();

commit;
