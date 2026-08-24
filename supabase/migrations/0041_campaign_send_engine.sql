-- Adendo — Disparos: motor de agendamento/rate-limit. A tabela e o cron job
-- aqui só IDENTIFICAM o que está devido e despacham para a edge function
-- send-campaign-batch via pg_net (mesmo padrão de call_webhook em 0018) —
-- o envio de verdade (chamada ao ChannelProvider, personalização de
-- template, atualização de status por destinatário) é responsabilidade da
-- function, não do banco.
--
-- channel_send_rate_limit: adaptação de api_rate_limit (0013) para
-- granularidade de CANAL/MINUTO em vez de usuário/hora — o limite que
-- importa aqui é o do provedor (Evolution API / Instagram Graph) por
-- número conectado, não por usuário do CRM.
--
-- campaign_followup_log: tabela nova, não prevista explicitamente no
-- schema do adendo, mas necessária para o critério de aceite "follow-up
-- para de disparar assim que o destinatário responde" sem duplicar envio —
-- sem ela não há como saber se uma regra de follow-up já foi aplicada a um
-- destinatário específico numa varredura de cron que roda a cada minuto.
begin;

create table public.channel_send_rate_limit (
  id            uuid primary key default gen_random_uuid(),
  channel_id    uuid not null references public.channels(id),
  window_start  timestamptz not null,
  send_count    integer not null default 1,
  constraint channel_send_rate_limit_uq unique (channel_id, window_start)
);

create index channel_send_rate_limit_lookup_idx on public.channel_send_rate_limit(channel_id, window_start);

alter table public.channel_send_rate_limit enable row level security;
-- Deny-all via RLS sem policy nenhuma (mesmo padrão de api_rate_limit) —
-- só check_channel_send_rate_limit() (security definer) toca essa tabela.

create or replace function public.check_channel_send_rate_limit(p_channel_id uuid, p_max_per_minute integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_window_start timestamptz := date_trunc('minute', now());
  v_count integer;
begin
  insert into public.channel_send_rate_limit (channel_id, window_start, send_count)
  values (p_channel_id, v_window_start, 1)
  on conflict (channel_id, window_start)
  do update set send_count = channel_send_rate_limit.send_count + 1
  returning send_count into v_count;

  return v_count <= p_max_per_minute;
end;
$$;

revoke execute on function public.check_channel_send_rate_limit(uuid, integer) from public, anon, authenticated;
grant execute on function public.check_channel_send_rate_limit(uuid, integer) to service_role;

create table public.campaign_followup_log (
  id                     uuid primary key default gen_random_uuid(),
  campaign_recipient_id  uuid not null references public.campaign_recipients(id) on delete cascade,
  followup_rule_id       uuid not null references public.campaign_followup_rules(id) on delete cascade,
  sent_at                timestamptz not null default now(),
  constraint campaign_followup_log_uq unique (campaign_recipient_id, followup_rule_id)
);

alter table public.campaign_followup_log enable row level security;

create policy campaign_followup_log_all on public.campaign_followup_log
  for all using (
    exists (
      select 1 from public.campaign_recipients cr
      join public.campaigns c on c.id = cr.campaign_id
      where cr.id = campaign_followup_log.campaign_recipient_id and public.is_own(c.owner_id)
    )
  ) with check (
    exists (
      select 1 from public.campaign_recipients cr
      join public.campaigns c on c.id = cr.campaign_id
      where cr.id = campaign_followup_log.campaign_recipient_id and public.is_own(c.owner_id)
    )
  );

create index campaign_recipients_sent_at_idx on public.campaign_recipients(sent_at)
  where status in ('sent', 'delivered', 'read');

-- ============ Scheduled dispatcher (pg_cron, every minute) ============
create or replace function public.run_scheduled_campaigns()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_base_url text;
  v_service_key text;
  camp record;
  fu record;
  v_request_id bigint;
begin
  select value into v_base_url from public.internal_config where key = 'edge_functions_base_url';
  select value into v_service_key from public.internal_config where key = 'service_role_key';
  if v_base_url is null or v_service_key is null then
    return; -- não configurado neste deploy ainda; nada a fazer
  end if;

  -- Campanhas agendadas vencidas: marca 'sending' atomicamente (evita
  -- disparo duplo no próximo scan, 1 minuto depois) e despacha.
  for camp in
    update public.campaigns
    set status = 'sending'
    where status = 'scheduled' and scheduled_at <= now()
    returning id
  loop
    select net.http_post(
      url := v_base_url || '/functions/v1/send-campaign-batch',
      body := jsonb_build_object('type', 'campaign', 'campaign_id', camp.id),
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_service_key)
    ) into v_request_id;
  end loop;

  -- Follow-ups vencidos: destinatário sem resposta (ou stop_on_reply=false)
  -- após wait_hours desde o envio, ainda não processado por esta regra.
  for fu in
    select cr.id as recipient_id, r.id as rule_id
    from public.campaign_recipients cr
    join public.campaign_followup_rules r on r.campaign_id = cr.campaign_id
    where cr.status in ('sent', 'delivered', 'read')
      and cr.sent_at is not null
      and cr.sent_at + make_interval(hours => r.wait_hours) <= now()
      and (r.stop_on_reply = false or cr.status <> 'replied')
      and not exists (
        select 1 from public.campaign_followup_log l
        where l.campaign_recipient_id = cr.id and l.followup_rule_id = r.id
      )
  loop
    select net.http_post(
      url := v_base_url || '/functions/v1/send-campaign-batch',
      body := jsonb_build_object('type', 'followup', 'campaign_recipient_id', fu.recipient_id, 'followup_rule_id', fu.rule_id),
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_service_key)
    ) into v_request_id;
  end loop;
end;
$$;

select cron.schedule('run-scheduled-campaigns', '* * * * *', $$select public.run_scheduled_campaigns();$$);

commit;
