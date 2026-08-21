-- Module 4 — Sales Pipeline business rules, enforced in the database.
--
-- Design: `status` and `closed_at` on opportunities are DERIVED from the
-- target stage's is_won/is_lost flags, not independently settable by the
-- app — this is the only way to guarantee status can never drift out of
-- sync with the stage it's sitting in. The one deliberate exception is
-- reopen_opportunity(), which needs to set status back to 'open' WITHOUT
-- moving the stage (the row is still sitting on a won/lost stage until a
-- subsequent, normal stage-move happens). That function flips a
-- transaction-local flag so the sync trigger knows to let it through.
--
-- Trigger firing order on opportunities relies on alphabetical trigger
-- naming (Postgres fires same-timing row triggers in name order):
--   opp_1_validate_stage_transition (BEFORE) — structural checks, can abort
--   opp_2_sync_status                (BEFORE) — derives status/closed_at
--   opp_3_log_stage_history          (AFTER)  — audit trail, needs bypass RLS
begin;

-- ============ opp_1: structural validation ============
create or replace function public.opportunities_validate_stage_transition()
returns trigger
language plpgsql
as $$
begin
  if TG_OP = 'INSERT' or NEW.pipeline_id <> OLD.pipeline_id or NEW.stage_id <> OLD.stage_id then
    if not exists (
      select 1 from public.pipeline_stages
      where id = NEW.stage_id and pipeline_id = NEW.pipeline_id
    ) then
      raise exception 'stage_id % does not belong to pipeline_id %', NEW.stage_id, NEW.pipeline_id;
    end if;
  end if;

  if TG_OP = 'UPDATE' and NEW.stage_id <> OLD.stage_id and OLD.status in ('won', 'lost') then
    raise exception 'cannot change stage of a closed opportunity (status=%); call reopen_opportunity() first', OLD.status;
  end if;

  return NEW;
end;
$$;

create trigger opp_1_validate_stage_transition
  before insert or update on public.opportunities
  for each row execute function public.opportunities_validate_stage_transition();

-- ============ opp_2: derive status/closed_at from the stage ============
create or replace function public.opportunities_sync_status()
returns trigger
language plpgsql
as $$
declare
  v_is_won boolean;
  v_is_lost boolean;
begin
  if TG_OP = 'INSERT' or NEW.stage_id <> OLD.stage_id then
    select is_won, is_lost into v_is_won, v_is_lost
    from public.pipeline_stages where id = NEW.stage_id;

    if v_is_won then
      NEW.status := 'won';
      NEW.closed_at := now();
    elsif v_is_lost then
      NEW.status := 'lost';
      NEW.closed_at := now();
    else
      NEW.status := 'open';
      NEW.closed_at := null;
    end if;

  elsif TG_OP = 'UPDATE' and (NEW.status <> OLD.status or NEW.closed_at is distinct from OLD.closed_at) then
    -- status/closed_at may only change together with an actual stage
    -- transition (handled above) — except reopen_opportunity(), which sets
    -- this transaction-local flag before its stage-unchanged status update.
    if coalesce(current_setting('app.reopening_opportunity', true), '') <> 'true' then
      NEW.status := OLD.status;
      NEW.closed_at := OLD.closed_at;
    end if;
  end if;

  return NEW;
end;
$$;

create trigger opp_2_sync_status
  before insert or update on public.opportunities
  for each row execute function public.opportunities_sync_status();

-- ============ opp_3: stage history audit trail ============
-- security definer: opportunity_stage_history has no INSERT policy for
-- regular clients (Module 3 decision) — only this trigger, running as the
-- table owner, writes here.
create or replace function public.opportunities_log_stage_history()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if TG_OP = 'INSERT' then
    insert into public.opportunity_stage_history (opportunity_id, from_stage_id, to_stage_id, changed_by)
    values (NEW.id, null, NEW.stage_id, auth.uid());
  elsif TG_OP = 'UPDATE' and NEW.stage_id <> OLD.stage_id then
    insert into public.opportunity_stage_history (opportunity_id, from_stage_id, to_stage_id, changed_by)
    values (NEW.id, OLD.stage_id, NEW.stage_id, auth.uid());
  end if;
  return NEW;
end;
$$;

create trigger opp_3_log_stage_history
  after insert or update on public.opportunities
  for each row execute function public.opportunities_log_stage_history();

-- ============ reopen_opportunity() ============
-- security definer so it can flip status back to 'open' via the trusted
-- flag path in opportunities_sync_status(); explicitly re-checks
-- permission itself since SECURITY DEFINER bypasses RLS on the UPDATE it
-- performs. auth.uid() is null => trusted backend context (same pattern as
-- prevent_role_escalation), so the check is skipped there.
create or replace function public.reopen_opportunity(p_opportunity_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_owner_id uuid;
begin
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'p_reason is required to reopen an opportunity';
  end if;

  select status, owner_id into v_status, v_owner_id
  from public.opportunities where id = p_opportunity_id;

  if v_status is null then
    raise exception 'opportunity % not found', p_opportunity_id;
  end if;

  if v_status not in ('won', 'lost') then
    raise exception 'opportunity % is not closed (status=%), nothing to reopen', p_opportunity_id, v_status;
  end if;

  if auth.uid() is not null and not (
    public.has_permission('opportunities', 'update')
    and public.is_visible_by_scope(v_owner_id, 'opportunities', 'update')
  ) then
    raise exception 'permission denied to reopen opportunity %', p_opportunity_id;
  end if;

  perform set_config('app.reopening_opportunity', 'true', true);
  update public.opportunities set status = 'open', closed_at = null where id = p_opportunity_id;
  perform set_config('app.reopening_opportunity', 'false', true);

  insert into public.activities (type, payload, actor_id, related_to_type, related_to_id)
  values (
    'opportunity_reopened',
    jsonb_build_object('reason', p_reason, 'previous_status', v_status),
    auth.uid(),
    'opportunity',
    p_opportunity_id
  );
end;
$$;

-- ============ Forecast view ============
-- Weighted forecast (value * stage probability) for open opportunities,
-- grouped by owner / team / pipeline / expected-close month. RLS on the
-- underlying tables applies automatically since this is a plain view
-- (runs with the querying role's privileges, not the view owner's) — a
-- Sales Rep querying this only ever sums their own visible opportunities.
create view public.opportunity_forecast as
select
  o.owner_id,
  tm.team_id,
  o.pipeline_id,
  date_trunc('month', o.expected_close_date)::date as forecast_month,
  count(*) as opportunity_count,
  sum(o.value) as total_value,
  sum(o.value * ps.probability / 100.0) as weighted_forecast
from public.opportunities o
join public.pipeline_stages ps on ps.id = o.stage_id
left join public.team_members tm on tm.user_id = o.owner_id
where o.status = 'open'
group by o.owner_id, tm.team_id, o.pipeline_id, date_trunc('month', o.expected_close_date);

-- ============ Pipeline metrics: average time per stage ============
create view public.opportunity_stage_duration as
select
  osh.opportunity_id,
  osh.to_stage_id as stage_id,
  osh.changed_at as entered_at,
  lead(osh.changed_at) over (partition by osh.opportunity_id order by osh.changed_at) as left_at,
  lead(osh.changed_at) over (partition by osh.opportunity_id order by osh.changed_at) - osh.changed_at as duration
from public.opportunity_stage_history osh;

create view public.pipeline_stage_avg_duration as
select
  ps.pipeline_id,
  ps.id as stage_id,
  ps.name as stage_name,
  ps.display_order,
  avg(osd.duration) as avg_duration
from public.pipeline_stages ps
left join public.opportunity_stage_duration osd on osd.stage_id = ps.id and osd.duration is not null
group by ps.pipeline_id, ps.id, ps.name, ps.display_order;

-- ============ Pipeline metrics: conversion rate between consecutive stages ============
create view public.pipeline_stage_conversion as
with reached as (
  select distinct opportunity_id, to_stage_id as stage_id
  from public.opportunity_stage_history
),
stage_counts as (
  select ps.id as stage_id, ps.pipeline_id, ps.display_order, ps.name,
    count(r.opportunity_id) as reached_count
  from public.pipeline_stages ps
  left join reached r on r.stage_id = ps.id
  group by ps.id, ps.pipeline_id, ps.display_order, ps.name
)
select
  sc.pipeline_id,
  sc.stage_id,
  sc.name as stage_name,
  sc.display_order,
  sc.reached_count,
  lag(sc.reached_count) over (partition by sc.pipeline_id order by sc.display_order) as previous_stage_count,
  case
    when lag(sc.reached_count) over (partition by sc.pipeline_id order by sc.display_order) > 0
    then round(100.0 * sc.reached_count / lag(sc.reached_count) over (partition by sc.pipeline_id order by sc.display_order), 2)
    else null
  end as conversion_rate_pct
from stage_counts sc
order by sc.pipeline_id, sc.display_order;

commit;
