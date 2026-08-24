-- Adendo — Atendente IA (config + base de conhecimento).
--
-- channel_id null = configuração padrão do tenant, usada quando o canal
-- que recebeu a mensagem não tem uma config própria. A resolução
-- "config do canal, senão config padrão do tenant" é responsabilidade da
-- function que monta o prompt (módulo Atendente IA, não desta migration).
begin;

create table public.ai_agent_configs (
  id                uuid primary key default gen_random_uuid(),
  owner_id          uuid not null references public.users(id),
  channel_id        uuid references public.channels(id),
  name              text not null,
  system_prompt     text not null,
  variables         jsonb not null default '{}',
  business_hours    jsonb,
  off_hours_message text,
  is_active         boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create table public.ai_knowledge_documents (
  id                    uuid primary key default gen_random_uuid(),
  ai_agent_config_id    uuid not null references public.ai_agent_configs(id) on delete cascade,
  source_type           text not null check (source_type in ('pdf', 'link', 'text')),
  source_url            text,
  content_extracted     text,
  created_at            timestamptz not null default now()
);

-- No mais uma config "padrão" ativa por canal (evita ambiguidade na hora
-- de resolver qual config usar para uma mensagem recebida naquele canal).
create unique index ai_agent_configs_channel_uq on public.ai_agent_configs(channel_id) where channel_id is not null;
create unique index ai_agent_configs_default_uq on public.ai_agent_configs(owner_id) where channel_id is null;

create index ai_agent_configs_owner_id_idx on public.ai_agent_configs(owner_id);
create index ai_knowledge_documents_config_id_idx on public.ai_knowledge_documents(ai_agent_config_id);

create trigger set_updated_at before update on public.ai_agent_configs
  for each row execute function public.set_updated_at();

-- Tenant integrity: channel_id, quando presente, precisa ser do mesmo tenant.
create or replace function public.ai_agent_configs_validate_tenant()
returns trigger
language plpgsql
as $$
declare
  v_channel_owner uuid;
begin
  if NEW.channel_id is not null then
    select owner_id into v_channel_owner from public.channels where id = NEW.channel_id;
    if v_channel_owner is distinct from NEW.owner_id then
      raise exception 'channel_id % does not belong to the same tenant as this ai_agent_config', NEW.channel_id;
    end if;
  end if;
  return NEW;
end;
$$;

create trigger ai_agent_1_validate_tenant before insert or update on public.ai_agent_configs
  for each row execute function public.ai_agent_configs_validate_tenant();

alter table public.ai_agent_configs enable row level security;
alter table public.ai_knowledge_documents enable row level security;

create policy ai_agent_configs_all on public.ai_agent_configs
  for all using (public.is_own(owner_id)) with check (public.is_own(owner_id));

create policy ai_knowledge_documents_all on public.ai_knowledge_documents
  for all using (
    exists (select 1 from public.ai_agent_configs c where c.id = ai_knowledge_documents.ai_agent_config_id and public.is_own(c.owner_id))
  ) with check (
    exists (select 1 from public.ai_agent_configs c where c.id = ai_knowledge_documents.ai_agent_config_id and public.is_own(c.owner_id))
  );

commit;
