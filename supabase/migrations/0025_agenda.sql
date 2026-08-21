-- Module: Agenda — appointments + automatic reminders.
--
-- Reminders are NOT built on the Module 8 workflow engine (that's for
-- user-configured automations); this is a core, always-on product
-- feature the mockup describes as already active ("Lembretes automáticos
-- ativados"), so it's two dedicated pg_cron jobs writing straight to
-- `notification`, same pattern as run_scheduled_workflows but simpler.
begin;

-- notification.related_to_type didn't include 'appointment' yet (Module 8
-- only knew about company/contact/opportunity/task).
alter table public.notification drop constraint if exists notification_related_to_type_check;
alter table public.notification add constraint notification_related_to_type_check
  check (related_to_type in ('company', 'contact', 'opportunity', 'task', 'appointment'));

create table public.appointment (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.users(id),
  title text not null,
  description text,
  start_at timestamptz not null,
  end_at timestamptz,
  related_to_type text check (related_to_type in ('company', 'contact', 'opportunity')),
  related_to_id uuid,
  reminder_minutes_before integer not null default 30,
  reminded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint appointment_related_to_both_or_neither check (
    (related_to_type is null and related_to_id is null) or
    (related_to_type is not null and related_to_id is not null)
  )
);

create index appointment_owner_start_idx on public.appointment(owner_id, start_at);
create index appointment_reminder_scan_idx on public.appointment(start_at) where reminded_at is null;

create trigger set_updated_at before update on public.appointment
  for each row execute function public.set_updated_at();

alter table public.appointment enable row level security;

create policy appointment_all on public.appointment
  for all using (public.is_own(owner_id)) with check (public.is_own(owner_id));

-- ============ Reminder: N minutes before start_at ============
-- Runs every 5 minutes; catches any appointment whose reminder window
-- (start_at - reminder_minutes_before) has arrived since the last run,
-- and hasn't already been reminded (reminded_at is null, set atomically
-- in the same statement to avoid double-sending on overlapping runs).
create or replace function public.send_appointment_reminders()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  appt record;
begin
  for appt in
    select id, owner_id, title, start_at
    from public.appointment
    where reminded_at is null
      and start_at - (reminder_minutes_before || ' minutes')::interval <= now()
      and start_at > now()
  loop
    insert into public.notification (user_id, title, body, related_to_type, related_to_id)
    values (
      appt.owner_id,
      'Compromisso em breve',
      appt.title || ' às ' || to_char(appt.start_at, 'HH24:MI'),
      'appointment',
      appt.id
    );
    update public.appointment set reminded_at = now() where id = appt.id;
  end loop;
end;
$$;

select cron.schedule('send-appointment-reminders', '*/5 * * * *', $$select public.send_appointment_reminders();$$);

-- ============ Daily task digest: once a day, only if there's something to say ============
create or replace function public.send_daily_task_digest()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  u record;
  v_pending integer;
  v_overdue integer;
begin
  for u in select id from public.users where is_active loop
    select count(*) filter (where status = 'pending'), count(*) filter (where status = 'pending' and due_at < now())
    into v_pending, v_overdue
    from public.tasks
    where owner_id = u.id;

    if v_pending > 0 then
      insert into public.notification (user_id, title, body)
      values (
        u.id,
        'Resumo do seu dia',
        case
          when v_overdue > 0 then format('Você tem %s tarefa(s) pendente(s), %s atrasada(s).', v_pending, v_overdue)
          else format('Você tem %s tarefa(s) pendente(s) hoje.', v_pending)
        end
      );
    end if;
  end loop;
end;
$$;

select cron.schedule('send-daily-task-digest', '0 8 * * *', $$select public.send_daily_task_digest();$$);

commit;
