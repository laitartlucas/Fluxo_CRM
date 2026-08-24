// send-conversation-message
//
// Input (JSON body):
//   { conversation_id: uuid, content: string, content_type?: 'text'|'image'|'audio'|'video'|'document', source?: 'human'|'workflow' }
//
// Auth: Authorization: Bearer <JWT>. Aceita tanto um JWT de usuário final
// (inbox do frontend) quanto o service_role JWT (chamado via pg_net pela
// action `send_message` do motor de Fluxos, ver execute_workflow_action em
// 0039). Não há branch de código para isso — um client Postgres criado com
// o Authorization repassado já resolve sozinho: JWT de usuário = RLS
// aplicada normalmente (is_own); JWT service_role = RLS bypassada pelo
// próprio Postgres, sem precisar de um adminClient separado aqui.
//
// `source: 'workflow'` distingue quem está mandando a mensagem para efeito
// de `sender_type`: humano vira 'human_agent' (e o trigger de 0032 pausa a
// IA automaticamente), automação de Fluxo vira 'ai_agent' — mais próximo
// do enum existente (contact/human_agent/ai_agent) do que fingir que foi um
// humano digitando.
//
// Permissions: a UPDATE/SELECT abaixo roda sob RLS do caller — uma
// conversa fora do tenant do usuário retorna 0 linhas, tratado como 403.
//
// Error format: { error: { code, message } }, non-2xx status.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { getChannelProvider, ChannelProviderError, type ChannelRow } from "../_shared/channel-provider.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface RequestBody {
  conversation_id?: string;
  content?: string;
  content_type?: "text" | "image" | "audio" | "video" | "document";
  source?: "human" | "workflow";
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return errorResponse("method_not_allowed", "Use POST", 405);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return errorResponse("unauthenticated", "Missing Authorization header", 401);
  }

  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return errorResponse("invalid_json", "Request body must be valid JSON", 400);
  }

  const { conversation_id, content } = body;
  const contentType = body.content_type ?? "text";
  const source = body.source ?? "human";

  if (!conversation_id || !UUID_RE.test(conversation_id)) {
    return errorResponse("invalid_input", "conversation_id must be a valid UUID", 400);
  }
  if (!content || content.trim().length === 0) {
    return errorResponse("invalid_input", "content is required", 400);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: conversation, error: convError } = await userClient
    .from("conversations")
    .select("id, channel_id, contact_id, channels(id, owner_id, type, provider, phone_number, external_account_id, credential_ref), contacts(id, phone)")
    .eq("id", conversation_id)
    .maybeSingle<{
      id: string;
      channel_id: string;
      contact_id: string | null;
      channels: ChannelRow;
      contacts: { id: string; phone: string | null } | null;
    }>();

  if (convError) {
    return errorResponse("query_failed", convError.message, 500);
  }
  if (!conversation) {
    return errorResponse("forbidden", "Conversation not found or you do not have access to it", 403);
  }
  if (!conversation.contacts?.phone) {
    return errorResponse("invalid_state", "Conversation's contact has no phone/external address on file", 422);
  }

  let senderId: string | null = null;
  const senderType = source === "workflow" ? "ai_agent" : "human_agent";
  if (senderType === "human_agent") {
    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData?.user) {
      return errorResponse("unauthenticated", "Could not resolve caller identity from JWT", 401);
    }
    senderId = userData.user.id;
  }

  let externalMessageId: string;
  try {
    const provider = getChannelProvider(conversation.channels);
    const result = await provider.sendMessage({
      channel: conversation.channels,
      to: conversation.contacts.phone,
      contentType,
      content,
    });
    externalMessageId = result.externalMessageId;
  } catch (err) {
    const message = err instanceof ChannelProviderError ? err.message : (err instanceof Error ? err.message : String(err));
    return errorResponse("provider_send_failed", message, 502);
  }

  const { data: inserted, error: insertError } = await userClient
    .from("messages")
    .insert({
      conversation_id: conversation.id,
      direction: "outbound",
      sender_type: senderType,
      sender_id: senderId,
      content_type: contentType,
      content,
      external_message_id: externalMessageId,
      status: "sent",
    })
    .select("id, sent_at")
    .single();

  if (insertError) {
    return errorResponse("query_failed", insertError.message, 500);
  }

  return jsonResponse({ message: inserted });
});
