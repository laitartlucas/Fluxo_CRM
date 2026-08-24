-- Adendo — Comunicação Omnichannel: canais conectados (tela "Contas").
--
-- Provider decision (documented, not silent): Evolution API (self-hosted,
-- não-oficial) para WhatsApp, Instagram Graph API (Meta, oficial) para
-- Instagram — não existe gateway não-oficial maduro para Instagram DMs.
-- 'meta_cloud_api'/'uazapi' do menu de opções original não foram
-- adotados; o check constraint reflete só o que foi de fato decidido.
--
-- credential_ref: nunca o token de acesso em si. Aponta para uma entrada
-- no Supabase Vault (ou secrets manager equivalente) resolvida em runtime
-- pelas edge functions — evita token de WhatsApp/Instagram em texto puro
-- numa tabela coberta por pg_dump/backup comum.
begin;

create table public.channels (
  id                    uuid primary key default gen_random_uuid(),
  owner_id              uuid not null references public.users(id),
  type                  text not null check (type in ('whatsapp', 'instagram')),
  provider              text not null check (provider in ('evolution_api', 'instagram_graph_api')),
  display_name          text not null,
  phone_number          text,
  external_account_id   text,
  credential_ref         text,
  status                text not null default 'pending_qr' check (status in ('connected', 'disconnected', 'error', 'pending_qr')),
  quality_rating        text check (quality_rating in ('green', 'yellow', 'red')),
  is_sandbox            boolean not null default false,
  connected_at          timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint channels_type_provider_match check (
    (type = 'whatsapp' and provider = 'evolution_api') or
    (type = 'instagram' and provider = 'instagram_graph_api')
  )
);

create index channels_owner_id_idx on public.channels(owner_id);

create trigger set_updated_at before update on public.channels
  for each row execute function public.set_updated_at();

alter table public.channels enable row level security;

create policy channels_all on public.channels
  for all using (public.is_own(owner_id)) with check (public.is_own(owner_id));

alter publication supabase_realtime add table public.channels;

commit;
