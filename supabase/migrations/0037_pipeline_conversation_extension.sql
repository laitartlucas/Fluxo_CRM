-- Adendo — extensão do Módulo 4 (Pipeline): campo de próxima ação/follow-up,
-- usado no Kanban e na timeline do contato.
--
-- opportunities.conversation_id "implícito" não é uma coluna nova aqui —
-- é a relação inversa de conversations.opportunity_id (já criada em
-- 0032). Uma opportunity pode ter 0..N conversas apontando pra ela; o
-- frontend resolve "a conversa ativa" via
-- `select * from conversations where opportunity_id = ? order by last_message_at desc limit 1`,
-- não precisa de FK no sentido opportunities -> conversations.
begin;

alter table public.opportunities
  add column next_action_at timestamptz,
  add column next_action_note text;

create index opportunities_next_action_idx on public.opportunities(next_action_at) where next_action_at is not null;

commit;
