-- Module 3 — Permissions: reusable security definer functions.
--
-- Both functions are SECURITY DEFINER, owned by the migration role
-- (postgres), which owns every table here and therefore bypasses RLS on
-- them automatically. This is what breaks the recursion that would
-- otherwise happen if role_permission/permission/users/team_members had
-- RLS policies that themselves needed has_permission() to evaluate.
--
-- has_permission: coarse check — does the caller's role have ANY grant
-- (any scope) for this (resource, action)? Used for INSERT/DELETE gating
-- and as the first half of every SELECT/UPDATE policy.
--
-- is_visible_by_scope: row-level check — given a specific row's owner_id,
-- does the caller's granted scope for (resource, action) cover this row?
-- Deviates from the literal 2-arg spec signature by adding p_action,
-- because scope legitimately differs per action (e.g. a Manager might
-- have 'team' for select but only 'own' for update) — a 2-arg version
-- can't express that correctly.
begin;

create or replace function public.has_permission(p_resource text, p_action text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.users u
    join public.role_permission rp on rp.role_id = u.role_id
    join public.permission p on p.id = rp.permission_id
    where u.id = auth.uid()
      and p.resource = p_resource
      and p.action = p_action
  );
$$;

create or replace function public.is_visible_by_scope(p_owner_id uuid, p_resource text, p_action text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_scope text;
begin
  select p.scope into v_scope
  from public.users u
  join public.role_permission rp on rp.role_id = u.role_id
  join public.permission p on p.id = rp.permission_id
  where u.id = auth.uid()
    and p.resource = p_resource
    and p.action = p_action
  order by case p.scope when 'all' then 3 when 'team' then 2 when 'own' then 1 end desc
  limit 1;

  if v_scope is null then
    return false;
  elsif v_scope = 'all' then
    return true;
  elsif v_scope = 'own' then
    return p_owner_id = auth.uid();
  elsif v_scope = 'team' then
    return exists (
      select 1
      from public.team_members tm_self
      join public.team_members tm_owner on tm_owner.team_id = tm_self.team_id
      where tm_self.user_id = auth.uid()
        and tm_owner.user_id = p_owner_id
    );
  end if;

  return false;
end;
$$;

-- activities has no owner_id of its own — visibility is derived from the
-- record it's attached to (related_to_type/related_to_id). This centralizes
-- that 4-way lookup so every activities policy (select/insert/update/delete)
-- can call is_visible_by_scope() the same way every other table does.
create or replace function public.get_related_owner(p_related_to_type text, p_related_to_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select case p_related_to_type
    when 'company' then (select owner_id from public.companies where id = p_related_to_id)
    when 'contact' then (select owner_id from public.contacts where id = p_related_to_id)
    when 'opportunity' then (select owner_id from public.opportunities where id = p_related_to_id)
    when 'task' then (select owner_id from public.tasks where id = p_related_to_id)
  end;
$$;

-- Prevents a user from self-granting a role or reactivating/deactivating
-- their own account through a normal UPDATE on their own row. Only
-- callers with users/update_role/all (Admin, Owner) may change role_id or
-- is_active — everyone else's UPDATE on those two columns is silently
-- reverted to the previous value rather than rejected outright, so a
-- profile-edit request that also (accidentally or not) touched these
-- fields still succeeds for the fields it's allowed to change.
--
-- The guard only applies when there IS an identified end-user session
-- (auth.uid() is not null) lacking the permission. A null auth.uid() means
-- there is no JWT in play at all — the postgres superuser role (migrations,
-- this project's own admin scripts) or Supabase's service_role (Module 6
-- Edge Functions, e.g. invite-member assigning the initial role) — both of
-- which are trusted backend contexts that already bypass RLS entirely, so
-- this trigger must not re-impose a restriction RLS itself doesn't apply.
create or replace function public.prevent_role_escalation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null and not public.has_permission('users', 'update_role') then
    new.role_id := old.role_id;
    new.is_active := old.is_active;
  end if;
  return new;
end;
$$;

create trigger prevent_role_escalation before update on public.users
  for each row execute function public.prevent_role_escalation();

commit;
