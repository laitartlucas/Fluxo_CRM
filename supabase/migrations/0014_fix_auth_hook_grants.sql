-- Fix: custom_access_token_hook (Module 2) was failing in production with
-- "permission denied for table users". Root cause: supabase_auth_admin
-- (the role GoTrue uses to invoke the hook) has rolbypassrls = false and
-- had no table-level SELECT grant on public.users, so its read inside the
-- hook was rejected before RLS policies were even evaluated. Caught via
-- real end-to-end testing in Module 6 (direct SQL testing in Module 2 only
-- ran as the postgres role, which masked this).
begin;

grant select on public.users to supabase_auth_admin;

create policy users_select_for_auth_admin on public.users
  for select
  to supabase_auth_admin
  using (true);

commit;
