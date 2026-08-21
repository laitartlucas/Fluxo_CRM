-- Module 2 — Authentication
--
-- 1) Link public.users.id to auth.users.id (1:1 identity, no duplication).
--    Table is empty (no production data), so a plain FK add is safe.
-- 2) Trigger on auth.users that auto-populates public.users on every new
--    auth identity (covers signup AND admin invite — both are an INSERT
--    into auth.users under the hood).
-- 3) Custom Access Token Hook: rejects token issuance (login AND refresh)
--    for users with is_active = false, even with valid credentials. This
--    function must additionally be wired up in the Supabase Dashboard
--    (Authentication -> Hooks -> Custom Access Token) — that registration
--    step cannot be done via SQL migration.
begin;

alter table public.users
  add constraint users_id_fkey foreign key (id) references auth.users(id) on delete cascade;

alter table public.users alter column id drop default;

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_is_active boolean;
begin
  select is_active into v_is_active
  from public.users
  where id = (event->>'user_id')::uuid;

  if v_is_active is false then
    -- Structured error (not a raised exception): GoTrue turns this into a
    -- clean 403 to the client instead of a generic 500. See migration
    -- 0015 for why this shape was chosen (found via real login testing).
    return jsonb_build_object(
      'error', jsonb_build_object(
        'http_code', 403,
        'message', 'This account has been deactivated.'
      )
    );
  end if;

  return event;
end;
$$;

grant usage on schema public to supabase_auth_admin;
grant execute on function public.custom_access_token_hook to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook from authenticated, anon, public;
-- supabase_auth_admin does not bypass RLS (rolbypassrls = false) and needs
-- to read public.users from inside this hook — see migration 0014 for the
-- grant + policy that makes that read possible (also found via real
-- end-to-end testing, not visible when testing as the postgres role).

commit;
