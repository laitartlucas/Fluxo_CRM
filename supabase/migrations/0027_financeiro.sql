-- Module: Financeiro — manual charge tracking (no payment gateway, no
-- recurrence — confirmed with the user; each charge is a one-off record
-- she creates and marks paid herself when the client pays her outside the
-- system).
--
-- status: 'proposed' (still being negotiated/quoted) -> 'pending'
-- (confirmed, awaiting payment) -> 'paid'. "Atrasado" (overdue) is NOT a
-- stored state — it's derived (status='pending' and due_date < today),
-- same reasoning as tasks: a status column would drift out of sync with
-- the calendar the moment nobody manually updates it.
begin;

create table public.charge (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.users(id),
  contact_id uuid not null references public.contacts(id),
  description text not null,
  value numeric(14, 2) not null check (value >= 0),
  due_date date not null,
  payment_method text not null check (payment_method in ('pix', 'cartao', 'boleto', 'dinheiro', 'transferencia', 'outro')),
  status text not null default 'pending' check (status in ('proposed', 'pending', 'paid')),
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index charge_owner_due_date_idx on public.charge(owner_id, due_date);
create index charge_contact_idx on public.charge(contact_id);

create trigger set_updated_at before update on public.charge
  for each row execute function public.set_updated_at();

-- Keeps paid_at consistent with status without relying on the app to set
-- it correctly every time — same derive-don't-trust-the-client pattern
-- used for tasks.completed_at and opportunities.closed_at.
create or replace function public.charge_sync_paid_at()
returns trigger
language plpgsql
as $$
begin
  if NEW.status = 'paid' and (TG_OP = 'INSERT' or OLD.status <> 'paid') then
    NEW.paid_at := now();
  elsif NEW.status <> 'paid' and TG_OP = 'UPDATE' and OLD.status = 'paid' then
    NEW.paid_at := null;
  end if;
  return NEW;
end;
$$;

create trigger charge_1_sync_paid_at before insert or update on public.charge
  for each row execute function public.charge_sync_paid_at();

alter table public.charge enable row level security;

create policy charge_all on public.charge
  for all using (public.is_own(owner_id)) with check (public.is_own(owner_id));

alter publication supabase_realtime add table public.charge;

commit;
