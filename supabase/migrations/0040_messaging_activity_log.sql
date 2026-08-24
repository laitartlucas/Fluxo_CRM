-- Adendo — timeline de mensageria: activities automáticas para
-- mensagens/conversas, mesmo padrão trigger-driven de 0012 (nenhum helper
-- log_activity() compartilhado nesse projeto — cada módulo insere direto).
--
-- Auditoria da IA (critério de aceite do adendo: "é possível auditar
-- exatamente qual prompt gerou qual resposta") NÃO está aqui. O trigger de
-- messages abaixo só sabe o que já está na linha inserida (sender_type,
-- content) — não o prompt completo (system_prompt resolvido + variáveis +
-- trechos da base de conhecimento + histórico) que gerou aquela resposta,
-- porque esse conteúdo só existe na edge function ai-agent-respond antes de
-- ela decidir enviar. Por isso a function grava a activity de auditoria ela
-- mesma (via service_role), com o prompt completo no payload, além (não em
-- vez) da activity genérica 'message_sent_ai' que este trigger cria aqui.
begin;

create or replace function public.messages_log_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_type text;
begin
  if NEW.is_internal_note then
    return NEW;
  end if;

  if NEW.direction = 'inbound' and NEW.sender_type = 'contact' then
    v_type := 'message_received';
  elsif NEW.direction = 'outbound' and NEW.sender_type = 'ai_agent' then
    v_type := 'message_sent_ai';
  elsif NEW.direction = 'outbound' and NEW.sender_type = 'human_agent' then
    v_type := 'message_sent_human';
  else
    return NEW;
  end if;

  insert into public.activities (type, payload, actor_id, related_to_type, related_to_id)
  values (
    v_type,
    jsonb_build_object('content_type', NEW.content_type, 'preview', left(coalesce(NEW.content, ''), 200), 'message_id', NEW.id),
    NEW.sender_id,
    'conversation',
    NEW.conversation_id
  );
  return NEW;
end;
$$;

create trigger msg_3_log_activity after insert on public.messages
  for each row execute function public.messages_log_activity();

create or replace function public.conversations_log_assignment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if TG_OP = 'UPDATE' and NEW.assigned_to is distinct from OLD.assigned_to then
    insert into public.activities (type, payload, actor_id, related_to_type, related_to_id)
    values (
      'conversation_assigned',
      jsonb_build_object('from_user_id', OLD.assigned_to, 'to_user_id', NEW.assigned_to),
      auth.uid(),
      'conversation',
      NEW.id
    );
  end if;
  return NEW;
end;
$$;

create trigger conv_3_log_assignment after update on public.conversations
  for each row execute function public.conversations_log_assignment();

commit;
