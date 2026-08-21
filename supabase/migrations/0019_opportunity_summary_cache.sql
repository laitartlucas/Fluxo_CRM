-- Module 9 — AI Agents: cache for the opportunity timeline summary.
-- Invalidation is data-driven, not trigger-driven: the Edge Function
-- compares last_activity_at against the timeline's actual latest activity
-- at read time, and only calls Claude when something new happened since
-- the cached summary was generated. No DB trigger needed.
begin;

create table public.opportunity_summary_cache (
  opportunity_id uuid primary key references public.opportunities(id) on delete cascade,
  summary text not null,
  activity_count integer not null,
  last_activity_at timestamptz,
  generated_at timestamptz not null default now()
);

alter table public.opportunity_summary_cache enable row level security;

create policy opportunity_summary_cache_select on public.opportunity_summary_cache
  for select using (
    exists (
      select 1 from public.opportunities o
      where o.id = opportunity_summary_cache.opportunity_id
        and public.has_permission('opportunities', 'select')
        and public.is_visible_by_scope(o.owner_id, 'opportunities', 'select')
    )
  );
-- No insert/update/delete policy: only the Edge Function, using the
-- service role, writes here (already access-checked via the opportunity
-- fetch it does first with the caller's own JWT).

commit;
