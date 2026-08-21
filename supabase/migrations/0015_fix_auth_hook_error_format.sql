-- Fix: custom_access_token_hook blocked deactivated users correctly, but
-- via a raised exception, which GoTrue surfaces as a generic HTTP 500 —
-- looks like a server crash rather than "access denied". Supabase Auth
-- Hooks support a structured error return instead (event -> 'error' with
-- an http_code), which produces a clean 403 to the client. Caught via
-- real end-to-end login testing in Module 6.
begin;

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

commit;
