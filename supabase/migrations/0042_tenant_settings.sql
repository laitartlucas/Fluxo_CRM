-- Adendo — Ajustes: branding (diferencial sugerido) + horário comercial
-- padrão do tenant. Não havia nenhuma tabela de configuração livre por
-- tenant no schema até aqui (users guarda identidade/auth, não preferências
-- de produto) — criada agora porque a tela de Ajustes do frontend precisa
-- de algum lugar para persistir isso.
--
-- Uma linha por tenant (owner_id é a própria PK, não um id próprio) —
-- não existe "múltiplos ajustes" por conta neste modelo solo-tenant.
begin;

create table public.tenant_settings (
  owner_id                  uuid primary key references public.users(id),
  brand_name                text,
  brand_logo_url            text,
  brand_primary_color       text,
  default_business_hours    jsonb,
  updated_at                timestamptz not null default now()
);

create trigger set_updated_at before update on public.tenant_settings
  for each row execute function public.set_updated_at();

alter table public.tenant_settings enable row level security;

create policy tenant_settings_all on public.tenant_settings
  for all using (public.is_own(owner_id)) with check (public.is_own(owner_id));

commit;
