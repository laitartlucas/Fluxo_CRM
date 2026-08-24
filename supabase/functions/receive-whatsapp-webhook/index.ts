// receive-whatsapp-webhook
//
// Recebe eventos do Evolution API (formato messages.upsert). Endpoint
// PÚBLICO — não tem Authorization de usuário, é chamado pelo Evolution API
// direto. A instância é configurada (fora deste projeto, na própria
// Evolution API) para apontar o webhook para
// `.../receive-whatsapp-webhook?channel_id=<uuid do canal>` — é assim que
// esta function sabe de qual `channels` row (e portanto de qual tenant)
// a mensagem é, já que o payload da Evolution API não carrega o owner do
// CRM, só o nome da instância.
//
// Idempotência: external_message_id (data.key.id) é UNIQUE global em
// `messages` — todo insert aqui usa `on conflict (external_message_id) do
// nothing`. Reenvio do mesmo webhook (comum em timeout) não duplica.
//
// Auth: nenhuma verificação de assinatura HMAC — Evolution API (self-hosted,
// não-oficial) não tem um padrão universal de assinatura de webhook como a
// Meta. Mitigação: o `channel_id` na query string funciona como um
// capability token de baixa entropia — não é uma proteção forte sozinha.
// Se a instância Evolution API suportar um header de autenticação
// configurável no webhook, validar isso aqui é um endurecimento futuro
// documentado, não implementado nesta passada (sem instância real para
// confirmar o que a versão em uso suporta).
//
// Error format: { error: { code, message } }. Sempre responde 200 mesmo em
// alguns casos de erro de negócio (ex: canal desconhecido) para a Evolution
// API não ficar re-tentando um payload que nunca vai ser processável.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders, jsonResponse, errorResponse } from "../_shared/cors.ts";
import type { ChannelRow } from "../_shared/channel-provider.ts";

interface EvolutionWebhookBody {
  event?: string;
  instance?: string;
  data?: {
    key?: { remoteJid?: string; fromMe?: boolean; id?: string };
    message?: Record<string, unknown>;
    messageTimestamp?: number;
    pushName?: string;
  };
}

function extractContent(message: Record<string, unknown> | undefined): { contentType: string; content: string | null } {
  if (!message) return { contentType: "text", content: null };
  if (typeof message.conversation === "string") return { contentType: "text", content: message.conversation };
  if (message.extendedTextMessage && typeof (message.extendedTextMessage as { text?: string }).text === "string") {
    return { contentType: "text", content: (message.extendedTextMessage as { text: string }).text };
  }
  if (message.imageMessage) return { contentType: "image", content: (message.imageMessage as { url?: string }).url ?? null };
  if (message.audioMessage) return { contentType: "audio", content: (message.audioMessage as { url?: string }).url ?? null };
  if (message.videoMessage) return { contentType: "video", content: (message.videoMessage as { url?: string }).url ?? null };
  if (message.documentMessage) return { contentType: "document", content: (message.documentMessage as { url?: string }).url ?? null };
  return { contentType: "text", content: null };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return errorResponse("method_not_allowed", "Use POST", 405);
  }

  const url = new URL(req.url);
  const channelId = url.searchParams.get("channel_id");
  if (!channelId) {
    return errorResponse("invalid_input", "channel_id query param is required", 400);
  }

  let body: EvolutionWebhookBody;
  try {
    body = await req.json();
  } catch {
    return errorResponse("invalid_json", "Request body must be valid JSON", 400);
  }

  if (body.event !== "messages.upsert" || !body.data) {
    return jsonResponse({ ok: true, ignored: true, reason: "not a messages.upsert event" });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  const { data: channel, error: channelError } = await adminClient
    .from("channels")
    .select("id, owner_id, type, provider, phone_number, external_account_id, credential_ref")
    .eq("id", channelId)
    .eq("type", "whatsapp")
    .maybeSingle<ChannelRow>();

  if (channelError) {
    return errorResponse("query_failed", channelError.message, 500);
  }
  if (!channel) {
    // 200 de propósito — Evolution API não deve re-tentar um channel_id
    // que nunca vai existir.
    return jsonResponse({ ok: true, ignored: true, reason: "unknown channel_id" });
  }

  const { key, message, messageTimestamp } = body.data;
  if (key?.fromMe) {
    // Mensagem enviada pelo próprio número (ex: humano usando o WhatsApp
    // diretamente no celular, fora do CRM). Não processamos como inbound —
    // o canal oficial de envio humano é send-conversation-message.
    return jsonResponse({ ok: true, ignored: true, reason: "fromMe message" });
  }

  const remoteJid = key?.remoteJid ?? "";
  const phone = remoteJid.split("@")[0];
  if (!phone) {
    return errorResponse("invalid_input", "could not extract sender phone from remoteJid", 400);
  }

  const { contentType, content } = extractContent(message);
  const externalMessageId = key?.id ?? crypto.randomUUID();
  const sentAt = messageTimestamp ? new Date(messageTimestamp * 1000).toISOString() : new Date().toISOString();

  // Find-or-create contact by (owner_id, phone).
  let { data: contact } = await adminClient
    .from("contacts")
    .select("id")
    .eq("owner_id", channel.owner_id)
    .eq("phone", phone)
    .maybeSingle<{ id: string }>();

  if (!contact) {
    const { data: newContact, error: contactError } = await adminClient
      .from("contacts")
      .insert({ owner_id: channel.owner_id, first_name: body.data.pushName ?? phone, phone, lead_source: "whatsapp" })
      .select("id")
      .single();
    if (contactError) {
      return errorResponse("query_failed", contactError.message, 500);
    }
    contact = newContact;
  }

  // Find-or-create conversation for (channel_id, contact_id).
  let { data: conversation } = await adminClient
    .from("conversations")
    .select("id, ai_paused")
    .eq("channel_id", channel.id)
    .eq("contact_id", contact!.id)
    .maybeSingle<{ id: string; ai_paused: boolean }>();

  if (!conversation) {
    const { data: newConv, error: convError } = await adminClient
      .from("conversations")
      .insert({ owner_id: channel.owner_id, channel_id: channel.id, contact_id: contact!.id })
      .select("id, ai_paused")
      .single();
    if (convError) {
      return errorResponse("query_failed", convError.message, 500);
    }
    conversation = newConv;
  }

  // upsert + ignoreDuplicates is supabase-js's way of expressing
  // `insert ... on conflict (external_message_id) do nothing` (0032's
  // mandated idempotency pattern) — plain .insert() has no onConflict option.
  // Also select the row back: with ignoreDuplicates, a skipped conflict
  // returns no row, which is exactly how we tell "genuinely new message"
  // apart from "webhook retry" — a retry must NOT re-trigger transcription
  // or a second AI reply for the same message.
  const { data: insertedRows, error: insertError } = await adminClient
    .from("messages")
    .upsert({
      conversation_id: conversation!.id,
      direction: "inbound",
      sender_type: "contact",
      content_type: contentType,
      content,
      external_message_id: externalMessageId,
      sent_at: sentAt,
    }, { onConflict: "external_message_id", ignoreDuplicates: true })
    .select("id");

  if (insertError) {
    return errorResponse("query_failed", insertError.message, 500);
  }
  if (!insertedRows || insertedRows.length === 0) {
    return jsonResponse({ ok: true, duplicate: true });
  }

  // Qualquer resposta do contato pausa follow-ups de campanha pendentes
  // para ele (0039/0041: campaign_replied dispara workflows; e o próprio
  // envio de follow-up para de ser considerado "devido" assim que o status
  // não é mais sent/delivered/read).
  await adminClient
    .from("campaign_recipients")
    .update({ status: "replied", replied_at: sentAt })
    .eq("contact_id", contact!.id)
    .in("status", ["sent", "delivered", "read"]);

  if (contentType === "audio" && content) {
    fetch(`${supabaseUrl}/functions/v1/transcribe-audio`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceRoleKey}` },
      body: JSON.stringify({ conversation_id: conversation!.id, external_message_id: externalMessageId, media_url: content }),
    }).catch((err) => console.error("transcribe-audio dispatch failed", err));
  }

  if (!conversation!.ai_paused) {
    fetch(`${supabaseUrl}/functions/v1/ai-agent-respond`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceRoleKey}` },
      body: JSON.stringify({ conversation_id: conversation!.id }),
    }).catch((err) => console.error("ai-agent-respond dispatch failed", err));
  }

  return jsonResponse({ ok: true });
});
