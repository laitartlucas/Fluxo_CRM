-- Adendo — extensões de schema (check constraints) para os módulos
-- seguintes (Comunicação, Atendente IA, Fluxos) já poderem gravar/disparar
-- os novos tipos sem precisar de outra migration depois. Nenhuma lógica de
-- negócio é implementada aqui — só o vocabulário permitido.
begin;

-- activities: histórico passa a registrar eventos de mensagem/conversa
-- (módulo Comunicação e Atendente IA escrevem aqui, ex. 'message_received',
-- 'message_sent_ai', 'ai_handoff', 'conversation_assigned').
alter table public.activities drop constraint if exists activities_related_to_type_check;
alter table public.activities add constraint activities_related_to_type_check
  check (related_to_type in ('company', 'contact', 'opportunity', 'task', 'conversation'));

-- notification: SLA de primeira resposta (diferencial) e alertas de canal
-- (quality_rating caindo, desconexão) apontam pra conversation/channel.
alter table public.notification drop constraint if exists notification_related_to_type_check;
alter table public.notification add constraint notification_related_to_type_check
  check (related_to_type in ('company', 'contact', 'opportunity', 'task', 'appointment', 'conversation', 'channel'));

-- workflow: novos triggers de mensageria e novas ações.
alter table public.workflow drop constraint if exists workflow_trigger_type_check;
alter table public.workflow add constraint workflow_trigger_type_check
  check (trigger_type in (
    'opportunity_stage_change', 'task_overdue', 'contact_created',
    'message_received', 'conversation_idle', 'campaign_replied'
  ));

alter table public.workflow_action drop constraint if exists workflow_action_action_type_check;
alter table public.workflow_action add constraint workflow_action_action_type_check
  check (action_type in (
    'create_task', 'notify_user', 'update_field', 'call_webhook',
    'send_message', 'add_tag', 'move_opportunity_stage'
  ));

commit;
