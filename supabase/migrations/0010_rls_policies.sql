-- Module 3 — Permissions: enable RLS everywhere and define policies.
-- All policies route through has_permission()/is_visible_by_scope(), which
-- are SECURITY DEFINER and therefore safe from recursion against these
-- same RLS-protected tables (see 0009 for why).
begin;

-- ============ users ============
alter table public.users enable row level security;

create policy users_select on public.users
  for select using (auth.uid() is not null);

create policy users_update on public.users
  for update
  using (public.has_permission('users', 'update') and public.is_visible_by_scope(id, 'users', 'update'))
  with check (public.has_permission('users', 'update') and public.is_visible_by_scope(id, 'users', 'update'));

-- ============ teams / team_members ============
alter table public.teams enable row level security;

create policy teams_select on public.teams
  for select using (auth.uid() is not null);

create policy teams_write on public.teams
  for all
  using (public.has_permission('teams', 'update'))
  with check (public.has_permission('teams', 'update'));

alter table public.team_members enable row level security;

create policy team_members_select on public.team_members
  for select using (auth.uid() is not null);

create policy team_members_write on public.team_members
  for all
  using (public.has_permission('teams', 'update'))
  with check (public.has_permission('teams', 'update'));

-- ============ role / permission / role_permission (RBAC config) ============
alter table public.role enable row level security;
alter table public.permission enable row level security;
alter table public.role_permission enable row level security;

create policy role_select on public.role for select using (auth.uid() is not null);
create policy role_write on public.role for all
  using (public.has_permission('users', 'update_role')) with check (public.has_permission('users', 'update_role'));

create policy permission_select on public.permission for select using (auth.uid() is not null);
create policy permission_write on public.permission for all
  using (public.has_permission('users', 'update_role')) with check (public.has_permission('users', 'update_role'));

create policy role_permission_select on public.role_permission for select using (auth.uid() is not null);
create policy role_permission_write on public.role_permission for all
  using (public.has_permission('users', 'update_role')) with check (public.has_permission('users', 'update_role'));

-- ============ pipelines / pipeline_stages (shared config) ============
alter table public.pipelines enable row level security;

create policy pipelines_select on public.pipelines for select using (auth.uid() is not null);
create policy pipelines_write on public.pipelines for all
  using (public.has_permission('pipelines', 'update')) with check (public.has_permission('pipelines', 'update'));

alter table public.pipeline_stages enable row level security;

create policy pipeline_stages_select on public.pipeline_stages for select using (auth.uid() is not null);
create policy pipeline_stages_write on public.pipeline_stages for all
  using (public.has_permission('pipeline_stages', 'update')) with check (public.has_permission('pipeline_stages', 'update'));

-- ============ companies ============
alter table public.companies enable row level security;

create policy companies_select on public.companies
  for select using (
    public.has_permission('companies', 'select')
    and (deleted_at is null or public.has_permission('companies', 'delete'))
    and (
      public.is_visible_by_scope(owner_id, 'companies', 'select')
      or exists (select 1 from public.record_share rs where rs.resource_type = 'company' and rs.resource_id = companies.id and rs.shared_with_user_id = auth.uid())
    )
  );

create policy companies_insert on public.companies
  for insert with check (
    public.has_permission('companies', 'insert')
    and public.is_visible_by_scope(owner_id, 'companies', 'insert')
  );

create policy companies_update on public.companies
  for update
  using (
    public.has_permission('companies', 'update')
    and (
      public.is_visible_by_scope(owner_id, 'companies', 'update')
      or exists (select 1 from public.record_share rs where rs.resource_type = 'company' and rs.resource_id = companies.id and rs.shared_with_user_id = auth.uid())
    )
  )
  with check (
    public.has_permission('companies', 'update')
    and public.is_visible_by_scope(owner_id, 'companies', 'update')
  );

create policy companies_delete on public.companies
  for delete using (public.has_permission('companies', 'delete'));

-- ============ contacts ============
alter table public.contacts enable row level security;

create policy contacts_select on public.contacts
  for select using (
    public.has_permission('contacts', 'select')
    and (deleted_at is null or public.has_permission('contacts', 'delete'))
    and (
      public.is_visible_by_scope(owner_id, 'contacts', 'select')
      or exists (select 1 from public.record_share rs where rs.resource_type = 'contact' and rs.resource_id = contacts.id and rs.shared_with_user_id = auth.uid())
    )
  );

create policy contacts_insert on public.contacts
  for insert with check (
    public.has_permission('contacts', 'insert')
    and public.is_visible_by_scope(owner_id, 'contacts', 'insert')
  );

create policy contacts_update on public.contacts
  for update
  using (
    public.has_permission('contacts', 'update')
    and (
      public.is_visible_by_scope(owner_id, 'contacts', 'update')
      or exists (select 1 from public.record_share rs where rs.resource_type = 'contact' and rs.resource_id = contacts.id and rs.shared_with_user_id = auth.uid())
    )
  )
  with check (
    public.has_permission('contacts', 'update')
    and public.is_visible_by_scope(owner_id, 'contacts', 'update')
  );

create policy contacts_delete on public.contacts
  for delete using (public.has_permission('contacts', 'delete'));

-- ============ opportunities ============
alter table public.opportunities enable row level security;

create policy opportunities_select on public.opportunities
  for select using (
    public.has_permission('opportunities', 'select')
    and (
      public.is_visible_by_scope(owner_id, 'opportunities', 'select')
      or exists (select 1 from public.record_share rs where rs.resource_type = 'opportunity' and rs.resource_id = opportunities.id and rs.shared_with_user_id = auth.uid())
    )
  );

create policy opportunities_insert on public.opportunities
  for insert with check (
    public.has_permission('opportunities', 'insert')
    and public.is_visible_by_scope(owner_id, 'opportunities', 'insert')
  );

create policy opportunities_update on public.opportunities
  for update
  using (
    public.has_permission('opportunities', 'update')
    and (
      public.is_visible_by_scope(owner_id, 'opportunities', 'update')
      or exists (select 1 from public.record_share rs where rs.resource_type = 'opportunity' and rs.resource_id = opportunities.id and rs.shared_with_user_id = auth.uid())
    )
  )
  with check (
    public.has_permission('opportunities', 'update')
    and public.is_visible_by_scope(owner_id, 'opportunities', 'update')
  );

create policy opportunities_delete on public.opportunities
  for delete using (public.has_permission('opportunities', 'delete'));

-- ============ opportunity_stage_history (read-only audit trail) ============
alter table public.opportunity_stage_history enable row level security;

create policy opportunity_stage_history_select on public.opportunity_stage_history
  for select using (
    exists (
      select 1 from public.opportunities o
      where o.id = opportunity_stage_history.opportunity_id
        and public.has_permission('opportunities', 'select')
        and public.is_visible_by_scope(o.owner_id, 'opportunities', 'select')
    )
  );
-- No insert/update/delete policy: only the Module 4 trigger (running as
-- table owner, bypassing RLS) writes here. Direct client writes are denied
-- by default (RLS with no matching policy = deny).

-- ============ opportunity_contacts ============
alter table public.opportunity_contacts enable row level security;

create policy opportunity_contacts_select on public.opportunity_contacts
  for select using (
    exists (
      select 1 from public.opportunities o
      where o.id = opportunity_contacts.opportunity_id
        and public.has_permission('opportunities', 'select')
        and public.is_visible_by_scope(o.owner_id, 'opportunities', 'select')
    )
  );

create policy opportunity_contacts_write on public.opportunity_contacts
  for all
  using (
    exists (
      select 1 from public.opportunities o
      where o.id = opportunity_contacts.opportunity_id
        and public.has_permission('opportunities', 'update')
        and public.is_visible_by_scope(o.owner_id, 'opportunities', 'update')
    )
  )
  with check (
    exists (
      select 1 from public.opportunities o
      where o.id = opportunity_contacts.opportunity_id
        and public.has_permission('opportunities', 'update')
        and public.is_visible_by_scope(o.owner_id, 'opportunities', 'update')
    )
  );

-- ============ tasks ============
alter table public.tasks enable row level security;

create policy tasks_select on public.tasks
  for select using (
    public.has_permission('tasks', 'select')
    and public.is_visible_by_scope(owner_id, 'tasks', 'select')
  );

create policy tasks_insert on public.tasks
  for insert with check (
    public.has_permission('tasks', 'insert')
    and public.is_visible_by_scope(owner_id, 'tasks', 'insert')
  );

create policy tasks_update on public.tasks
  for update
  using (
    public.has_permission('tasks', 'update')
    and public.is_visible_by_scope(owner_id, 'tasks', 'update')
  )
  with check (
    public.has_permission('tasks', 'update')
    and public.is_visible_by_scope(owner_id, 'tasks', 'update')
  );

create policy tasks_delete on public.tasks
  for delete using (public.has_permission('tasks', 'delete'));

-- ============ activities (append-only timeline) ============
alter table public.activities enable row level security;

create policy activities_select on public.activities
  for select using (
    public.has_permission('activities', 'select')
    and public.is_visible_by_scope(public.get_related_owner(related_to_type, related_to_id), 'activities', 'select')
  );

create policy activities_insert on public.activities
  for insert with check (
    public.has_permission('activities', 'insert')
    and actor_id = auth.uid()
    and public.is_visible_by_scope(public.get_related_owner(related_to_type, related_to_id), 'activities', 'insert')
  );

create policy activities_update on public.activities
  for update
  using (public.has_permission('activities', 'update'))
  with check (public.has_permission('activities', 'update'));

create policy activities_delete on public.activities
  for delete using (public.has_permission('activities', 'delete'));

-- ============ record_share ============
alter table public.record_share enable row level security;

create policy record_share_select on public.record_share
  for select using (
    shared_with_user_id = auth.uid()
    or granted_by = auth.uid()
    or public.has_permission('record_share', 'select')
  );

create policy record_share_insert on public.record_share
  for insert with check (
    granted_by = auth.uid()
    and public.has_permission(
      case resource_type
        when 'company' then 'companies'
        when 'contact' then 'contacts'
        when 'opportunity' then 'opportunities'
        when 'task' then 'tasks'
      end,
      'update'
    )
  );

create policy record_share_delete on public.record_share
  for delete using (
    granted_by = auth.uid()
    or public.has_permission('record_share', 'delete')
  );

commit;
