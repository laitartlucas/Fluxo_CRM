-- Same bug as pipelines.name (migration 0022): workflow.name was globally
-- unique from the old single-org model, but workflows are per-tenant now.
begin;

alter table public.workflow drop constraint if exists workflow_name_key;
alter table public.workflow add constraint workflow_owner_name_uq unique (owner_id, name);

commit;
