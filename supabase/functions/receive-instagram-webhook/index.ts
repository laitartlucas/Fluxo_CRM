// receive-instagram-webhook
//
// Endpoint PÚBLICO chamado pela Meta (Instagram Messaging via Graph API,
// canal oficial — ver decisão documentada em supabase/migrations/0031_channels.sql).
//
// GET: handshake de verificação de assinatura do webhook (obrigatório antes
// de qualquer subscribe funcionar). A Meta chama com
// `?hub.mode=subscribe&hub.verify_token=...&hub.challenge=...`; se o token
// bater com INSTAGRAM_WEBHOOK_VERIFY_TOKEN, ecoa `hub.challenge` de volta
// como texto puro, 200.
//
// POST: payload no formato entry/messaging da Graph API. Verifica
// `X-Hub-Signature-256` (HMAC-SHA256 do corpo cru com INSTAGRAM_APP_SECRET)
// antes de processar — diferente do WhatsApp/Evolution API, a Meta tem um
// padrão de assinatura bem definido e documentado, então é verificado de
// verdade aqui (ao contrário do webhook do WhatsApp).
//
// `entry[].id` é o ID da conta profissional do Instagram que recebeu a
// mensagem — casado contra `channels.external_account_id` (type='instagram')
// para descobrir de qual tenant é.
//
// Idempotência: mesmo padrão do webhook de WhatsApp — external_message_id
// (message.mid) é UNIQUE global, upsert com ignoreDuplicates.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders, jsonResponse, errorResponse } from "../_shared/cors.ts";
import type { ChannelRow } from "../_shared/channel-provider.ts";

interface InstagramEntry {
  id?: string;
  messaging?: Array<{
    sender?: { id?: string };
    timestamp?: number;
    message?: {
      mid?: string;
      text?: string;
      attachments?: Array<{ type?: string; payload?: { url?: string } }>;
    };
  }>;
}

interface InstagramWebhookBody {
  object?: string;
  entry?: InstagramEntry[];
}

async function verifySignature(rawBody: string, signatureHeader: string | null, appSecret: string): Promise<boolean> {
  if (!signatureHeader?.startsWith("sha256=")) return false;
  const expectedHex = signatureHeader.slice("sha256=".length);

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(appSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signatureBytes = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const computedHex = Array.from(new Uint8Array(signatureBytes)).map((b) => b.toString(16).padStart(2, "0")).join("");

  // Comparação em tempo constante — evita timing attack na validação de HMAC.
  if (computedHex.length !== expectedHex.length) return false;
  let diff = 0;
  for (let i = 0; i < computedHex.length; i++) diff |= computedHex.charCodeAt(i) ^ expectedHex.charCodeAt(i);
  return diff === 0;
}

function extractContent(message: NonNullable<InstagramEntry["messaging"]>[number]["message"]): { contentType: string; content: string | null } {
  if (message?.text) return { contentType: "text", content: message.text };
  const attachment = message?.attachments?.[0];
  if (attachment?.type === "image") return { contentType: "image", content: attachment.payload?.url ?? null };
  if (attachment?.type === "audio") return { contentType: "audio", content: attachment.payload?.url ?? null };
  if (attachment?.type === "video") return { contentType: "video", content: attachment.payload?.url ?? null };
  if (attachment?.type === "file") return { contentType: "document", content: attachment.payload?.url ?? null };
  return { contentType: "text", content: null };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method === "GET") {
    const url = new URL(req.url);
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    const expectedToken = Deno.env.get("INSTAGRAM_WEBHOOK_VERIFY_TOKEN");

    if (mode === "subscribe" && token && expectedToken && token === expectedToken && challenge) {
      return new Response(challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
    }
    return errorResponse("forbidden", "verify_token mismatch", 403);
  }

  if (req.method !== "POST") {
    return errorResponse("method_not_allowed", "Use GET or POST", 405);
  }

  const rawBody = await req.text();
  const appSecret = Deno.env.get("INSTAGRAM_APP_SECRET");
  if (!appSecret) {
    return errorResponse("misconfigured", "INSTAGRAM_APP_SECRET not set for this Edge Functions project", 500);
  }
  const signatureOk = await verifySignature(rawBody, req.headers.get("X-Hub-Signature-256"), appSecret);
  if (!signatureOk) {
    return errorResponse("forbidden", "invalid X-Hub-Signature-256", 403);
  }

  let body: InstagramWebhookBody;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return errorResponse("invalid_json", "Request body must be valid JSON", 400);
  }

  if (body.object !== "instagram" || !body.entry?.length) {
    return jsonResponse({ ok: true, ignored: true });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  for (const entry of body.entry) {
    const igAccountId = entry.id;
    if (!igAccountId || !entry.messaging?.length) continue;

    const { data: channel } = await adminClient
      .from("channels")
      .select("id, owner_id, type, provider, phone_number, external_account_id, credential_ref")
      .eq("type", "instagram")
      .eq("external_account_id", igAccountId)
      .maybeSingle<ChannelRow>();

    if (!channel) continue; // conta desconhecida — nada a fazer, mas não é um erro (200 evita retry infinito da Meta)

    for (const event of entry.messaging) {
      const senderId = event.sender?.id;
      const mid = event.message?.mid;
      if (!senderId || !mid) continue;

      const { contentType, content } = extractContent(event.message);
      const sentAt = event.timestamp ? new Date(event.timestamp).toISOString() : new Date().toISOString();

      let { data: contact } = await adminClient
        .from("contacts")
        .select("id")
        .eq("owner_id", channel.owner_id)
        .eq("phone", senderId) // sem telefone real no Instagram; usamos o IGSID como chave de matching, mesma coluna
        .maybeSingle<{ id: string }>();

      if (!contact) {
        const { data: newContact } = await adminClient
          .from("contacts")
          .insert({ owner_id: channel.owner_id, first_name: `Instagram ${senderId}`, phone: senderId, lead_source: "instagram" })
          .select("id")
          .single();
        contact = newContact;
      }
      if (!contact) continue;

      let { data: conversation } = await adminClient
        .from("conversations")
        .select("id, ai_paused")
        .eq("channel_id", channel.id)
        .eq("contact_id", contact.id)
        .maybeSingle<{ id: string; ai_paused: boolean }>();

      if (!conversation) {
        const { data: newConv } = await adminClient
          .from("conversations")
          .insert({ owner_id: channel.owner_id, channel_id: channel.id, contact_id: contact.id })
          .select("id, ai_paused")
          .single();
        conversation = newConv;
      }
      if (!conversation) continue;

      const { data: insertedRows } = await adminClient
        .from("messages")
        .upsert({
          conversation_id: conversation.id,
          direction: "inbound",
          sender_type: "contact",
          content_type: contentType,
          content,
          external_message_id: mid,
          sent_at: sentAt,
        }, { onConflict: "external_message_id", ignoreDuplicates: true })
        .select("id");

      if (!insertedRows || insertedRows.length === 0) continue; // reenvio duplicado da Meta

      await adminClient
        .from("campaign_recipients")
        .update({ status: "replied", replied_at: sentAt })
        .eq("contact_id", contact.id)
        .in("status", ["sent", "delivered", "read"]);

      if (contentType === "audio" && content) {
        fetch(`${supabaseUrl}/functions/v1/transcribe-audio`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceRoleKey}` },
          body: JSON.stringify({ conversation_id: conversation.id, external_message_id: mid, media_url: content }),
        }).catch((err) => console.error("transcribe-audio dispatch failed", err));
      }

      if (!conversation.ai_paused) {
        fetch(`${supabaseUrl}/functions/v1/ai-agent-respond`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceRoleKey}` },
          body: JSON.stringify({ conversation_id: conversation.id }),
        }).catch((err) => console.error("ai-agent-respond dispatch failed", err));
      }
    }
  }

  return jsonResponse({ ok: true });
});
