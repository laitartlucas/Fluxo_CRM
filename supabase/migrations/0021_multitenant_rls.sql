-- Multi-tenant retrofit, part 2: replace every RLS policy that used
-- has_permission()/is_visible_by_scope() with the new is_own()/
-- is_platform_admin() model. Soft-delete trash visibility for Admin no
-- longer exists as a concept (no more admin-vs-regular inside one
-- tenant) — deleted rows are just hidden from everyone now.
begin;

-- ============ users ============
drop policy if exists users_select on public.users;
drop policy if exists users_update on public.users;

create policy users_select on public.users
  for select using (id = auth.uid() or public.is_platform_admin());

create policy users_update on public.users
  for update
  using (id = auth.uid() or public.is_platform_admin())
  with check (id = auth.uid() or public.is_platform_admin());

-- ============ pipelines / pipeline_stages ============
drop policy if exists pipelines_select on public.pipelines;
drop policy if exists pipelines_write on public.pipelines;

create policy pipelines_all on public.pipelines
  for all using (public.is_own(owner_id)) with check (public.is_own(owner_id));

drop policy if exists pipeline_stages_select on public.pipeline_stages;
drop policy if exists pipeline_stages_write on public.pipeline_stages;

create policy pipeline_stages_all on public.pipeline_stages
  for all using (
    exists (select 1 from public.pipelines p where p.id = pipeline_stages.pipeline_id and public.is_own(p.owner_id))
  ) with check (
    exists (select 1 from public.pipelines p where p.id = pipeline_stages.pipeline_id and public.is_own(p.owner_id))
  );

-- ============ companies ============
drop policy if exists companies_select on public.companies;
drop policy if exists companies_insert on public.companies;
drop policy if exists companies_update on public.companies;
drop policy if exists companies_delete on public.companies;

create policy companies_select on public.companies
  for select using (public.is_own(owner_id) and deleted_at is null);

create policy companies_insert on public.companies
  for insert with check (public.is_own(owner_id));

create policy companies_update on public.companies
  for update using (public.is_own(owner_id)) with check (public.is_own(owner_id));

create policy companies_delete on public.companies
  for delete using (public.is_own(owner_id));

-- ============ contacts ============
drop policy if exists contacts_select on public.contacts;
drop policy if exists contacts_insert on public.contacts;
drop policy if exists contacts_update on public.contacts;
drop policy if exists contacts_delete on public.contacts;

create policy contacts_select on public.contacts
  for select using (public.is_own(owner_id) and deleted_at is null);

create policy contacts_insert on public.contacts
  for insert with check (public.is_own(owner_id));

create policy contacts_update on public.contacts
  for update using (public.is_own(owner_id)) with check (public.is_own(owner_id));

create policy contacts_delete on public.contacts
  for delete using (public.is_own(owner_id));

-- ============ opportunities ============
drop policy if exists opportunities_select on public.opportunities;
drop policy if exists opportunities_insert on public.opportunities;
drop policy if exists opportunities_update on public.opportunities;
drop policy if exists opportunities_delete on public.opportunities;

create policy opportunities_select on public.opportunities
  for select using (public.is_own(owner_id));

create policy opportunities_insert on public.opportunities
  for insert with check (public.is_own(owner_id));

create policy opportunities_update on public.opportunities
  for update using (public.is_own(owner_id)) with check (public.is_own(owner_id));

create policy opportunities_delete on public.opportunities
  for delete using (public.is_own(owner_id));

-- ============ opportunity_stage_history (read-only audit trail) ============
drop policy if exists opportunity_stage_history_select on public.opportunity_stage_history;

create policy opportunity_stage_history_select on public.opportunity_stage_history
  for select using (
    exists (select 1 from public.opportunities o where o.id = opportunity_stage_history.opportunity_id and public.is_own(o.owner_id))
  );

-- ============ opportunity_contacts ============
drop policy if exists opportunity_contacts_select on public.opportunity_contacts;
drop policy if exists opportunity_contacts_write on public.opportunity_contacts;

create policy opportunity_contacts_all on public.opportunity_contacts
  for all using (
    exists (select 1 from public.opportunities o where o.id = opportunity_contacts.opportunity_id and public.is_own(o.owner_id))
  ) with check (
    exists (select 1 from public.opportunities o where o.id = opportunity_contacts.opportunity_id and public.is_own(o.owner_id))
  );

-- ============ tasks ============
drop policy if exists tasks_select on public.tasks;
drop policy if exists tasks_insert on public.tasks;
drop policy if exists tasks_update on public.tasks;
drop policy if exists tasks_delete on public.tasks;

create policy tasks_select on public.tasks for select using (public.is_own(owner_id));
create policy tasks_insert on public.tasks for insert with check (public.is_own(owner_id));
create policy tasks_update on public.tasks for update using (public.is_own(owner_id)) with check (public.is_own(owner_id));
create policy tasks_delete on public.tasks for delete using (public.is_own(owner_id));

-- ============ activities (append-only; owner_id derived via get_related_owner) ============
drop policy if exists activities_select on public.activities;
drop policy if exists activities_insert on public.activities;
drop policy if exists activities_update on public.activities;
drop policy if exists activities_delete on public.activities;

create policy activities_select on public.activities
  for select using (public.is_own(public.get_related_owner(related_to_type, related_to_id)));

create policy activities_insert on public.activities
  for insert with check (actor_id = auth.uid() and public.is_own(public.get_related_owner(related_to_type, related_to_id)));

-- No update/delete policy at all now: activities are append-only for
-- everyone, full stop — there's no more admin-correction exception, since
-- there's no more admin-vs-regular distinction inside a tenant.

-- ============ workflow / workflow_condition / workflow_action ============
drop policy if exists workflow_all on public.workflow;
create policy workflow_all on public.workflow
  for all using (public.is_own(owner_id)) with check (public.is_own(owner_id));

drop policy if exists workflow_condition_all on public.workflow_condition;
create policy workflow_condition_all on public.workflow_condition
  for all using (
    exists (select 1 from public.workflow w where w.id = workflow_condition.workflow_id and public.is_own(w.owner_id))
  ) with check (
    exists (select 1 from public.workflow w where w.id = workflow_condition.workflow_id and public.is_own(w.owner_id))
  );

drop policy if exists workflow_action_all on public.workflow_action;
create policy workflow_action_all on public.workflow_action
  for all using (
    exists (select 1 from public.workflow w where w.id = workflow_action.workflow_id and public.is_own(w.owner_id))
  ) with check (
    exists (select 1 from public.workflow w where w.id = workflow_action.workflow_id and public.is_own(w.owner_id))
  );

drop policy if exists workflow_execution_log_select on public.workflow_execution_log;
create policy workflow_execution_log_select on public.workflow_execution_log
  for select using (public.is_own(owner_id));

-- ============ opportunity_summary_cache ============
drop policy if exists opportunity_summary_cache_select on public.opportunity_summary_cache;
create policy opportunity_summary_cache_select on public.opportunity_summary_cache
  for select using (
    exists (select 1 from public.opportunities o where o.id = opportunity_summary_cache.opportunity_id and public.is_own(o.owner_id))
  );

-- notification: unchanged (already user_id = auth.uid(), already tenant-safe).

commit;
