-- Fix: opportunity_forecast (Module 4) joined team_members for a "team_id"
-- forecast dimension. Dropping team_members with CASCADE (multi-tenant
-- retrofit) silently cascade-dropped this view too — team_id has no
-- meaning anymore anyway (1 user = 1 tenant, no teams), so it's just
-- removed from the grouping rather than replaced. Found via real
-- end-to-end browser testing (dashboard 500), not a design review.
begin;

create view public.opportunity_forecast as
select
  o.owner_id,
  o.pipeline_id,
  date_trunc('month', o.expected_close_date)::date as forecast_month,
  count(*) as opportunity_count,
  sum(o.value) as total_value,
  sum(o.value * ps.probability / 100.0) as weighted_forecast
from public.opportunities o
join public.pipeline_stages ps on ps.id = o.stage_id
where o.status = 'open'
group by o.owner_id, o.pipeline_id, date_trunc('month', o.expected_close_date);

commit;
