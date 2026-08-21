-- Module 6 — API: rate limiting for sensitive Edge Functions
-- (bulk-import-contacts, invite-member). Fixed hourly window, per user per
-- endpoint. Simple on purpose — this is a single-org, 70-user internal
-- tool, not a public API; a DB-backed counter is sufficient and testable,
-- no external infra (Redis, API gateway policies) needed at this scale.
begin;

create table public.api_rate_limit (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id),
  endpoint text not null,
  window_start timestamptz not null,
  request_count integer not null default 1,
  constraint api_rate_limit_uq unique (user_id, endpoint, window_start)
);

create index api_rate_limit_lookup_idx on public.api_rate_limit(user_id, endpoint, window_start);

-- RLS enabled with ZERO policies = deny-all for every role except the
-- table owner. Without this, the default Supabase grants would let any
-- authenticated client read/write this table directly (e.g. DELETE their
-- own rows to reset their limit), defeating the whole point. Only
-- check_rate_limit() (SECURITY DEFINER, owned by postgres) can touch it.
alter table public.api_rate_limit enable row level security;

-- Returns true if this call is within the limit (and records it), false if
-- the caller has exceeded p_max_per_window requests to p_endpoint in the
-- current clock-hour window. security definer: the table has no RLS
-- policy at all (deliberate — this is purely backend bookkeeping, never
-- read or written by client-facing queries directly, only through this
-- function, which Edge Functions call using the service role).
create or replace function public.check_rate_limit(p_user_id uuid, p_endpoint text, p_max_per_window integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_window_start timestamptz := date_trunc('hour', now());
  v_count integer;
begin
  insert into public.api_rate_limit (user_id, endpoint, window_start, request_count)
  values (p_user_id, p_endpoint, v_window_start, 1)
  on conflict (user_id, endpoint, window_start)
  do update set request_count = api_rate_limit.request_count + 1
  returning request_count into v_count;

  return v_count <= p_max_per_window;
end;
$$;

-- p_max_per_window is caller-supplied, so this must NEVER be reachable by
-- an ordinary authenticated client (they could just pass a huge number to
-- bypass their own limit) — only Edge Functions, calling with the service
-- role, may invoke it. The threshold itself lives in each function's code.
revoke execute on function public.check_rate_limit(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.check_rate_limit(uuid, text, integer) to service_role;

commit;
