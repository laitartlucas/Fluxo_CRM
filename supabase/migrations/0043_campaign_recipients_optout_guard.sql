-- Adendo — reforço de opt-out (LGPD) no nível do banco.
--
-- 0034 criou contacts.opted_out_at e send-campaign-batch já filtra por ele
-- na hora do envio, mas nada impedia um contato opted-out de ser INSERIDO
-- em campaign_recipients em primeiro lugar (só a UI de Disparos filtrava
-- na montagem da audiência). Isso deixa a garantia legal "sem exceção"
-- dependendo só de código de aplicação — um bug de UI, uma chamada direta
-- à tabela, ou uma futura ação de Fluxo que adicione destinatários
-- contornaria a regra silenciosamente. Este trigger fecha o buraco na
-- própria tabela, igual ao padrão já usado para bloquear nota interna
-- outbound (0032) e para validação de tenant (0036/0037/0039).
begin;

create or replace function public.campaign_recipients_block_opted_out()
returns trigger
language plpgsql
as $$
declare
  v_opted_out_at timestamptz;
begin
  select opted_out_at into v_opted_out_at
  from public.contacts
  where id = NEW.contact_id;

  if v_opted_out_at is not null then
    raise exception 'contact % opted out at % and cannot be added as a campaign recipient', NEW.contact_id, v_opted_out_at;
  end if;

  return NEW;
end;
$$;

create trigger campaign_recipients_block_opted_out before insert on public.campaign_recipients
  for each row execute function public.campaign_recipients_block_opted_out();

commit;
