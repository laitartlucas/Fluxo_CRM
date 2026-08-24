-- Adendo — Disparos/Campanhas (envio em massa via canal de mensageria).
--
-- Nome no plural (`campaigns`) é deliberado para não colidir com a tabela
-- `campaign` (singular) do módulo Marketing (0028) — que é atribuição de
-- origem de lead ("qual campanha trouxe esse contato"), um conceito
-- diferente de "disparo em massa para uma audiência". As duas tabelas
-- coexistem; não são a mesma coisa e não se fundem.
--
-- Restrição de Instagram (sem equivalente a template aprovado, sem envio
-- fora da janela de 24h): não é uma constraint de banco, é validação de
-- UI (módulo Disparos) — o schema permite channel_id apontar para um
-- canal Instagram porque follow-up dentro de uma janela de 24h aberta é
-- um caso de uso legítimo; o que a UI deve impedir é configurar uma
-- campanha FRIA (primeiro contato) num canal Instagram.
begin;

create table public.campaign_templates (
  id                      uuid primary key default gen_random_uuid(),
  owner_id                uuid not null references public.users(id),
  name                    text not null,
  channel_id              uuid references public.channels(id),
  provider_template_id    text,
  body                    text not null,
  status                  text not null default 'draft' check (status in ('draft', 'pending_approval', 'approved', 'rejected')),
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create table public.campaigns (
  id                uuid primary key default gen_random_uuid(),
  owner_id          uuid not null references public.users(id),
  name              text not null,
  channel_id        uuid not null references public.channels(id),
  template_id       uuid references public.campaign_templates(id),
  audience_filter   jsonb,
  scheduled_at      timestamptz,
  status            text not null default 'draft' check (status in ('draft', 'scheduled', 'sending', 'completed', 'paused')),
  created_by        uuid references public.users(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create table public.campaign_recipients (
  id            uuid primary key default gen_random_uuid(),
  campaign_id   uuid not null references public.campaigns(id) on delete cascade,
  contact_id    uuid not null references public.contacts(id),
  status        text not null default 'pending' check (status in ('pending', 'sent', 'delivered', 'read', 'replied', 'failed', 'opted_out')),
  sent_at       timestamptz,
  replied_at    timestamptz,
  constraint campaign_recipients_uq unique (campaign_id, contact_id)
);

create table public.campaign_followup_rules (
  id                    uuid primary key default gen_random_uuid(),
  campaign_id           uuid not null references public.campaigns(id) on delete cascade,
  wait_hours            int not null check (wait_hours > 0),
  message_template_id   uuid references public.campaign_templates(id),
  stop_on_reply         boolean not null default true
);

create index campaign_templates_owner_id_idx on public.campaign_templates(owner_id);
create index campaigns_owner_id_idx on public.campaigns(owner_id);
create index campaigns_status_scheduled_idx on public.campaigns(status, scheduled_at) where status = 'scheduled';
create index campaign_recipients_campaign_id_idx on public.campaign_recipients(campaign_id);
create index campaign_recipients_status_idx on public.campaign_recipients(campaign_id, status);
create index campaign_followup_rules_campaign_id_idx on public.campaign_followup_rules(campaign_id);

create trigger set_updated_at before update on public.campaign_templates
  for each row execute function public.set_updated_at();

create trigger set_updated_at before update on public.campaigns
  for each row execute function public.set_updated_at();

-- Tenant integrity: template/channel referenced by a campaign must be the same tenant's.
create or replace function public.campaigns_validate_tenant()
returns trigger
language plpgsql
as $$
declare
  v_channel_owner uuid;
  v_template_owner uuid;
begin
  select owner_id into v_channel_owner from public.channels where id = NEW.channel_id;
  if v_channel_owner is distinct from NEW.owner_id then
    raise exception 'channel_id % does not belong to the same tenant as this campaign', NEW.channel_id;
  end if;

  if NEW.template_id is not null then
    select owner_id into v_template_owner from public.campaign_templates where id = NEW.template_id;
    if v_template_owner is distinct from NEW.owner_id then
      raise exception 'template_id % does not belong to the same tenant as this campaign', NEW.template_id;
    end if;
  end if;

  return NEW;
end;
$$;

create trigger campaign_1_validate_tenant before insert or update on public.campaigns
  for each row execute function public.campaigns_validate_tenant();

alter table public.campaign_templates enable row level security;
alter table public.campaigns enable row level security;
alter table public.campaign_recipients enable row level security;
alter table public.campaign_followup_rules enable row level security;

create policy campaign_templates_all on public.campaign_templates
  for all using (public.is_own(owner_id)) with check (public.is_own(owner_id));

create policy campaigns_all on public.campaigns
  for all using (public.is_own(owner_id)) with check (public.is_own(owner_id));

create policy campaign_recipients_all on public.campaign_recipients
  for all using (
    exists (select 1 from public.campaigns c where c.id = campaign_recipients.campaign_id and public.is_own(c.owner_id))
  ) with check (
    exists (select 1 from public.campaigns c where c.id = campaign_recipients.campaign_id and public.is_own(c.owner_id))
  );

create policy campaign_followup_rules_all on public.campaign_followup_rules
  for all using (
    exists (select 1 from public.campaigns c where c.id = campaign_followup_rules.campaign_id and public.is_own(c.owner_id))
  ) with check (
    exists (select 1 from public.campaigns c where c.id = campaign_followup_rules.campaign_id and public.is_own(c.owner_id))
  );

alter publication supabase_realtime add table public.campaigns;
alter publication supabase_realtime add table public.campaign_recipients;

commit;
