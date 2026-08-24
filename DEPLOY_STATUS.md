# Status do deploy — Adendo Comunicação Omnichannel

Contexto pra retomar em outra máquina/sessão. Não commitar nenhuma credencial real
neste arquivo — só referências (nome do secret, project ref), nunca o valor.

## O que já está feito

- **Backend**: projeto Supabase Cloud `mwsoocsdblpgwkfgwnwr` já tem as 45 migrations
  aplicadas (0001-0030 eram de uma implantação anterior, reconciliadas via
  `supabase migration repair`; 0031-0045 são o adendo, aplicadas nesta sessão).
- **Edge functions**: todas as 13 já deployadas nesse projeto.
- **Secrets configurados**: `ANTHROPIC_API_KEY` (pro Atendente IA). `OPENAI_API_KEY`
  (transcrição de áudio) e credenciais de canal (`credential_ref` por canal) ainda
  **não** foram configuradas — só necessárias quando for conectar WhatsApp/Instagram
  de verdade.
- **`internal_config`**: populada com `edge_functions_base_url` e `service_role_key`
  (necessário pra ação `send_message` dos Fluxos funcionar).
- **Conta de demonstração**: usuário existente `laitartlucas@gmail.com` (platform
  admin) — pipeline "Funil Principal" + 5 etapas criadas manualmente pra ele (essa
  conta é de antes do fluxo de convite existir, não passou pelo provisionamento
  automático).
- **Dados de demo**: `supabase/seed_demo.sql` rodado com sucesso nessa conta — 2
  empresas, 6 contatos, 6 oportunidades, 2 canais (visuais, sem credencial real), 3
  conversas com mensagens, 1 campanha, 1 fluxo, ajustes preenchidos.
- **Frontend**: `frontend/.env` configurado localmente (não commitado, está no
  `.gitignore`) com `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` desse projeto.
  Build de produção testado e limpo.
- **Git**: tudo commitado na branch `feature/comunicacao-omnichannel-adendo`, PR
  aberto (não mergeado ainda, aguardando decisão do usuário):
  https://github.com/laitartlucas/Fluxo_CRM/pull/new/feature/comunicacao-omnichannel-adendo

## Pendente

1. **Deploy do frontend em algum host público** (Vercel recomendado, decidido em
   conversa — mais barato que Railway pra um site estático). Ainda não configurado.
   Precisa de `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` como env vars de build.
2. **Merge da branch na `main`** — usuário decidiu deixar como está por enquanto.
3. **Fluxo de conexão self-service de WhatsApp/Instagram** — GAP CONHECIDO E
   CONFIRMADO COM O CLIENTE: hoje `channels.credential_ref` é só o nome de um secret
   de ambiente do projeto Supabase, configurado manualmente via CLI. Não há UI de
   QR code nem OAuth. Isso precisa ser construído antes de qualquer usuário real
   (inclusive o primeiro cliente) conseguir conectar o próprio WhatsApp/Instagram
   sem depender do desenvolvedor. Ver decisão registrada na conversa: WhatsApp via
   Evolution API (self-hosted, precisa de instância + exibição de QR code na tela
   Contas), Instagram via Meta Graph API (precisa de fluxo OAuth "Continuar com
   Facebook", app Meta próprio, App Review).
4. **Modelo de negócio confirmado**: ~70 usuários = 70 contas totalmente isoladas
   (multi-tenant, 1 login = 1 CRM próprio) — é o modelo que o sistema já implementa
   desde a migration `0020_multitenant_retrofit.sql`. Não é papéis/times dentro de
   uma conta compartilhada.
5. Ainda não testado: envio/recebimento real de mensagem (WhatsApp/Instagram) — os
   dois webhooks e o `ChannelProvider` foram implementados a partir da documentação
   pública, nunca validados contra uma instância real (ver comentário em
   `supabase/functions/_shared/channel-provider.ts`).

## Referências de credenciais usadas (sem os valores)

- Access token do Supabase: gerado em supabase.com/dashboard/account/tokens
- Project ref: `mwsoocsdblpgwkfgwnwr`
- Senha do banco: Project Settings → Database → Connection string
- `ANTHROPIC_API_KEY`: console.anthropic.com

Se `supabase login`/`railway login` derem erro de "non-TTY", é porque login
interativo (navegador) não funciona neste tipo de ambiente — use um access token
manual em vez disso (ver conversa anterior pro passo a passo).
