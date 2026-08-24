-- Adendo — fecha o gap de dedup de conversations com contact_id nulo.
--
-- conversations_channel_contact_uq (0032) é unique(channel_id, contact_id),
-- mas Postgres trata NULL como distinto em constraints únicas — duas linhas
-- com o mesmo channel_id e contact_id nulo não seriam bloqueadas. Na
-- prática isso nunca acontece: os dois únicos pontos que inserem em
-- conversations (receive-whatsapp-webhook, receive-instagram-webhook)
-- sempre resolvem ou criam um contact antes de criar a conversation — não
-- existe fluxo de UI nem de outra function que insira sem contact_id.
--
-- Em vez de tentar definir uma semântica de dedup para um caso que não
-- ocorre (não há outro identificador do remetente em conversations para
-- desempatar), a correção correta é tornar a garantia explícita: contact_id
-- passa a ser NOT NULL, o que faz a unique constraint existente cobrir
-- 100% dos casos sem precisar de índice parcial.
begin;

alter table public.conversations
  alter column contact_id set not null;

commit;
