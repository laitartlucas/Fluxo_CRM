-- Fix: pipelines.name was globally unique from the old single-org model.
-- Now that pipelines are per-tenant, every mentee's default "Funil
-- Principal" would collide with every other mentee's. Scope uniqueness to
-- (owner_id, name) instead — found via real multi-tenant provisioning
-- testing, not a design review.
begin;

alter table public.pipelines drop constraint if exists pipelines_name_key;
alter table public.pipelines add constraint pipelines_owner_name_uq unique (owner_id, name);

commit;
