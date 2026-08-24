-- Adendo — Comunicação Omnichannel: conversas e mensagens.
--
-- Idempotência de webhook: external_message_id é unique globalmente (não
-- por tenant — o id vem do provedor e é global por natureza). Todo
-- endpoint de recebimento de webhook DEVE usar
-- `insert ... on conflict (external_message_id) do nothing`. Sem isso, um
-- retry de webhook (comum em timeout) duplica a mensagem na tela do
-- cliente — o tipo de bug inaceitável num sistema vendido como confiável.
--
-- Notas internas nunca podem ser um envio real ao contato: reforçado aqui
-- via CHECK constraint (is_internal_note não pode conviver com
-- direction='outbound'), não só na lógica da aplicação. Convenção:
-- direction='inbound' para notas internas (não há um terceiro valor de
-- direção no schema — 'inbound' só significa "não foi um envio ao
-- contato" nesse caso, não que a nota "chegou" de alguém).
--
-- Regras estruturais resolvidas como triggers (determinísticas, auditáveis
-- via SQL puro, sem depender de nenhuma edge function estar no ar):
--   - toda conversa nova sem assigned_to é atribuída ao owner_id do tenant
--     (não há "fila de time" nesse modelo solo-tenant — 1 usuário por
--     conta; ver decisão registrada na conversa com o cliente/dev)
--   - mensagem inbound atualiza conversations.last_message_at
--   - mensagem outbound de um human_agent pausa a IA automaticamente
--     (ai_paused = true), evitando IA e humano respondendo ao mesmo tempo
begin;

create table public.conversations (
  id                uuid primary key default gen_random_uuid(),
  owner_id          uuid not null references public.users(id),
  channel_id        uuid not null references public.channels(id),
  contact_id        uuid references public.contacts(id),
  opportunity_id    uuid references public.opportunities(id),
  status            text not null default 'open' check (status in ('open', 'pending', 'closed')),
  assigned_to       uuid references public.users(id),
  ai_paused         boolean not null default false,
  last_message_at   timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint conversations_channel_contact_uq unique (channel_id, contact_id)
);

create table public.messages (
  id                    uuid primary key default gen_random_uuid(),
  conversation_id       uuid not null references public.conversations(id) on delete cascade,
  direction             text not null check (direction in ('inbound', 'outbound')),
  sender_type           text not null check (sender_type in ('contact', 'human_agent', 'ai_agent')),
  sender_id             uuid references public.users(id),
  content_type          text not null check (content_type in ('text', 'image', 'audio', 'video', 'document')),
  content               text,
  transcription         text,
  is_internal_note      boolean not null default false,
  external_message_id   text unique,
  status                text not null default 'sent' check (status in ('sent', 'delivered', 'read', 'failed')),
  sent_at               timestamptz not null default now(),
  constraint messages_internal_note_not_outbound check (not (is_internal_note and direction = 'outbound'))
);

create index idx_conversations_channel on public.conversations(channel_id);
create index idx_conversations_contact on public.conversations(contact_id);
create index idx_conversations_owner on public.conversations(owner_id);
create index idx_conversations_assigned on public.conversations(assigned_to) where status != 'closed';
create index idx_messages_conversation on public.messages(conversation_id, sent_at);

create trigger set_updated_at before update on public.conversations
  for each row execute function public.set_updated_at();

-- ============ Tenant integrity (defense in depth, same pattern as opportunities_validate_stage_transition) ============
create or replace function public.conversations_validate_tenant()
returns trigger
language plpgsql
as $$
declare
  v_channel_owner uuid;
  v_contact_owner uuid;
begin
  select owner_id into v_channel_owner from public.channels where id = NEW.channel_id;
  if v_channel_owner is distinct from NEW.owner_id then
    raise exception 'channel_id % does not belong to the same tenant as this conversation', NEW.channel_id;
  end if;

  if NEW.contact_id is not null then
    select owner_id into v_contact_owner from public.contacts where id = NEW.contact_id;
    if v_contact_owner is distinct from NEW.owner_id then
      raise exception 'contact_id % does not belong to the same tenant as this conversation', NEW.contact_id;
    end if;
  end if;

  return NEW;
end;
$$;

create trigger conv_1_validate_tenant before insert or update on public.conversations
  for each row execute function public.conversations_validate_tenant();

-- ============ Auto-assign: solo-tenant model has no team to round-robin across; every new conversation goes to the tenant owner ============
create or replace function public.conversations_auto_assign()
returns trigger
language plpgsql
as $$
begin
  if NEW.assigned_to is null then
    NEW.assigned_to := NEW.owner_id;
  end if;
  return NEW;
end;
$$;

create trigger conv_2_auto_assign before insert on public.conversations
  for each row execute function public.conversations_auto_assign();

-- ============ Message side-effects: bump last_message_at, auto-pause AI on human send ============
create or replace function public.messages_apply_side_effects()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.conversations
  set last_message_at = NEW.sent_at,
      ai_paused = case when NEW.direction = 'outbound' and NEW.sender_type = 'human_agent' then true else ai_paused end
  where id = NEW.conversation_id;
  return NEW;
end;
$$;

create trigger msg_1_apply_side_effects after insert on public.messages
  for each row execute function public.messages_apply_side_effects();

alter table public.conversations enable row level security;
alter table public.messages enable row level security;

create policy conversations_all on public.conversations
  for all using (public.is_own(owner_id)) with check (public.is_own(owner_id));

create policy messages_all on public.messages
  for all using (
    exists (select 1 from public.conversations c where c.id = messages.conversation_id and public.is_own(c.owner_id))
  ) with check (
    exists (select 1 from public.conversations c where c.id = messages.conversation_id and public.is_own(c.owner_id))
  );

alter publication supabase_realtime add table public.conversations;
alter publication supabase_realtime add table public.messages;

commit;
