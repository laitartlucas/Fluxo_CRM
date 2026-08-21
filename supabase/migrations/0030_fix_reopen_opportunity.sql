-- Fix: reopen_opportunity() still called has_permission()/is_visible_by_scope(),
-- both dropped by the multi-tenant retrofit (0020). Missed at the time
-- because that migration's own tests never happened to call
-- reopen_opportunity — caught now via Sucesso do Cliente's tests. Replaced
-- with the same is_own() check used everywhere else post-retrofit.
begin;

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

  if auth.uid() is not null and not public.is_own(v_owner_id) then
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

commit;
