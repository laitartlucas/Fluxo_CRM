-- Adendo — extensões em contacts: origem do lead (rastreamento livre) e
-- opt-out LGPD.
--
-- lead_source/lead_source_detail coexistem com source/campaign_id do
-- módulo Marketing (0028) por decisão explícita: source é um enum fixo
-- para o gráfico "Leads por origem"; lead_source é texto livre (captura
-- o valor bruto do primeiro contato, ex. utm_source), lead_source_detail
-- guarda o restante (utm_campaign, referral_code etc.). Não são a mesma
-- coisa — não colapsar em uma coluna só.
--
-- opted_out_at é obrigação legal (LGPD), não boa prática opcional: toda
-- campanha (módulo Disparos) deve filtrar `where opted_out_at is null`
-- sem exceção.
begin;

alter table public.contacts
  add column lead_source text,
  add column lead_source_detail jsonb,
  add column opted_out_at timestamptz;

create index contacts_opted_out_idx on public.contacts(opted_out_at) where opted_out_at is not null;

commit;
