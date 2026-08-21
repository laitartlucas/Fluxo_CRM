-- Module 7 — Frontend: enable Realtime Postgres Changes broadcast for the
-- tables the UI subscribes to live (Kanban, tasks list, timeline). Adding
-- a table to a publication is NOT the same as RLS — Realtime still
-- re-evaluates each row's RLS policies per subscriber before delivering a
-- change, so this only controls which tables CAN broadcast at all, not who
-- receives what. Found missing during real two-browser Realtime testing —
-- Supabase does not enable this by default per table.
begin;

alter publication supabase_realtime add table public.opportunities;
alter publication supabase_realtime add table public.tasks;
alter publication supabase_realtime add table public.activities;
alter publication supabase_realtime add table public.companies;

commit;
