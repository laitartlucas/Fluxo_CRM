-- Adendo — Painel: "custo por conversa" é uma métrica pedida pelo adendo,
-- mas não existe dado de custo por mensagem em nenhum lugar do schema (nem
-- os providers — Evolution API self-hosted, Instagram Graph API — expõem
-- isso via API; custo real depende do plano contratado pelo cliente fora
-- do sistema). Em vez de inventar um número, o tenant informa o próprio
-- custo estimado por mensagem em Ajustes; o Painel só calcula em cima
-- disso quando preenchido, e mostra uma nota pedindo para configurar
-- quando não está.
begin;

alter table public.tenant_settings
  add column cost_per_message numeric(10,4);

commit;
