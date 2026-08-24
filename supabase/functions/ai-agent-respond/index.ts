// ai-agent-respond
//
// Input (JSON body): { conversation_id: uuid }
// Auth: chamada apenas internamente (pelos webhooks de recebimento, com o
// service_role JWT) — nunca pelo frontend. Não há sessão de usuário para
// escopar RLS aqui, então esta function usa o adminClient (service role)
// do início ao fim, com bastante cuidado para nunca misturar dados de
// tenants diferentes (todo lookup é sempre filtrado por owner_id/conversation_id
// resolvidos a partir do próprio conversation_id recebido).
//
// O que decide a resposta (nessa ordem):
//   1. ai_paused / conversa fechada -> não responde.
//   2. Palavra-chave de opt-out (PARAR/SAIR/CANCELAR/STOP) na última
//      mensagem inbound -> marca opted_out_at, confirma e para (sem
//      chamar o modelo).
//   3. Fora do horário comercial (business_hours) -> envia off_hours_message
//      fixo (sem chamar o modelo).
//   4. Senão, monta o prompt (system_prompt com variáveis interpoladas +
//      base de conhecimento concatenada + histórico recente) e chama Claude.
//
// Dados enviados ao Claude: system_prompt do tenant (texto livre que o
// PRÓPRIO tenant escreveu), suas variáveis, o texto extraído dos documentos
// de conhecimento QUE ELE mesmo enviou, e o histórico só desta conversa.
// Nada de outro tenant nunca entra no prompt.
//
// RAG: sem embeddings/pgvector nesta passada (ver plano) — concatena o
// content_extracted de todos os ai_knowledge_documents ativos do config
// resolvido, cortado em ~6000 caracteres. Funciona bem para o volume
// esperado (poucos documentos por conta solo-tenant); se isso não bastar
// para algum cliente, revisitar com embeddings é o próximo passo, não algo
// resolvido aqui.
//
// Auditoria (critério de aceite do adendo): toda resposta da IA grava uma
// activities row tipo 'ai_prompt_audit' com o prompt completo usado —
// SEM isso, "auditar exatamente qual prompt gerou qual resposta" não seria
// possível.
//
// Handoff: o system prompt instrui o modelo a prefixar a resposta com a
// tag literal "[TRANSFERIR_HUMANO]" quando o cliente pedir atendimento
// humano ou o assunto fugir do que o agente foi configurado a responder.
// A tag é removida do texto antes de enviar ao cliente; detectá-la seta
// ai_paused=true e cria uma notification para o time.
//
// Error format: { error: { code, message } }, non-2xx status.

import Anthropic from "npm:@anthropic-ai/sdk";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { getChannelProvider, ChannelProviderError, type ChannelRow } from "../_shared/channel-provider.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OPT_OUT_RE = /^\s*(parar|sair|cancelar|stop)\s*[.!]?\s*$/i;
const HANDOFF_TAG = "[TRANSFERIR_HUMANO]";
const MAX_KNOWLEDGE_CHARS = 6000;
const HISTORY_LIMIT = 15;

const DAY_KEYS: Record<number, string[]> = {
  0: ["dom", "domingo"],
  1: ["seg", "segunda"],
  2: ["ter", "terca", "terça"],
  3: ["qua", "quarta"],
  4: ["qui", "quinta"],
  5: ["sex", "sexta"],
  6: ["sab", "sábado", "sabado"],
};

function isWithinBusinessHours(businessHours: Record<string, string> | null, now: Date): boolean {
  if (!businessHours || Object.keys(businessHours).length === 0) return true; // sem config = sempre disponível

  // America/Sao_Paulo — mercado-alvo deste produto é solo-tenant BR.
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const hh = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const mm = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  const nowMinutes = hh * 60 + mm;
  const weekdayShort = parts.find((p) => p.type === "weekday")?.value ?? ""; // "Mon", "Tue", ...
  const jsWeekdayIndex = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(weekdayShort);

  for (const [key, range] of Object.entries(businessHours)) {
    const [startDayRaw, endDayRaw] = key.toLowerCase().split("-").map((s) => s.trim());
    const startDay = findDayIndex(startDayRaw);
    const endDay = endDayRaw ? findDayIndex(endDayRaw) : startDay;
    if (startDay === -1 || endDay === -1) continue;

    const dayMatches = startDay <= endDay
      ? jsWeekdayIndex >= startDay && jsWeekdayIndex <= endDay
      : jsWeekdayIndex >= startDay || jsWeekdayIndex <= endDay; // faixa que cruza o domingo

    if (!dayMatches) continue;

    const [from, to] = (range ?? "").split("-").map((s) => s.trim());
    const [fromH, fromM] = (from ?? "00:00").split(":").map(Number);
    const [toH, toM] = (to ?? "23:59").split(":").map(Number);
    const fromMinutes = (fromH || 0) * 60 + (fromM || 0);
    const toMinutes = (toH || 0) * 60 + (toM || 0);

    if (nowMinutes >= fromMinutes && nowMinutes <= toMinutes) return true;
  }
  return false;
}

function findDayIndex(raw: string): number {
  for (const [idx, aliases] of Object.entries(DAY_KEYS)) {
    if (aliases.includes(raw)) return Number(idx);
  }
  return -1;
}

function interpolateVariables(template: string, variables: Record<string, unknown>): string {
  return template.replace(/\{(\w+)\}/g, (match, key) => {
    const value = variables[key];
    return value === undefined || value === null ? match : String(value);
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return errorResponse("method_not_allowed", "Use POST", 405);
  }

  let body: { conversation_id?: string };
  try {
    body = await req.json();
  } catch {
    return errorResponse("invalid_json", "Request body must be valid JSON", 400);
  }
  if (!body.conversation_id || !UUID_RE.test(body.conversation_id)) {
    return errorResponse("invalid_input", "conversation_id must be a valid UUID", 400);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  const { data: conversation, error: convError } = await adminClient
    .from("conversations")
    .select("id, owner_id, status, ai_paused, assigned_to, contact_id, channel_id, channels(id, owner_id, type, provider, phone_number, external_account_id, credential_ref), contacts(id, phone, first_name)")
    .eq("id", body.conversation_id)
    .maybeSingle<{
      id: string;
      owner_id: string;
      status: string;
      ai_paused: boolean;
      assigned_to: string | null;
      contact_id: string | null;
      channel_id: string;
      channels: ChannelRow;
      contacts: { id: string; phone: string | null; first_name: string } | null;
    }>();

  if (convError) return errorResponse("query_failed", convError.message, 500);
  if (!conversation) return jsonResponse({ ok: true, ignored: true, reason: "conversation not found" });
  if (conversation.ai_paused || conversation.status === "closed") {
    return jsonResponse({ ok: true, ignored: true, reason: "ai_paused or conversation closed" });
  }
  if (!conversation.contacts?.phone) {
    return jsonResponse({ ok: true, ignored: true, reason: "contact has no external address" });
  }

  const { data: lastInbound } = await adminClient
    .from("messages")
    .select("id, content, content_type")
    .eq("conversation_id", conversation.id)
    .eq("direction", "inbound")
    .order("sent_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string; content: string | null; content_type: string }>();

  // ============ 1. Opt-out por palavra-chave ============
  if (lastInbound?.content_type === "text" && lastInbound.content && OPT_OUT_RE.test(lastInbound.content)) {
    await adminClient.from("contacts").update({ opted_out_at: new Date().toISOString() }).eq("id", conversation.contact_id);
    await adminClient.from("conversations").update({ ai_paused: true }).eq("id", conversation.id);

    const confirmationText = "Certo, você não vai mais receber mensagens automáticas nossas. Se precisar de algo, é só chamar novamente.";
    try {
      const provider = getChannelProvider(conversation.channels);
      const result = await provider.sendMessage({ channel: conversation.channels, to: conversation.contacts.phone, contentType: "text", content: confirmationText });
      await adminClient.from("messages").insert({
        conversation_id: conversation.id, direction: "outbound", sender_type: "ai_agent",
        content_type: "text", content: confirmationText, external_message_id: result.externalMessageId, status: "sent",
      });
    } catch (err) {
      console.error("opt-out confirmation send failed", err);
    }
    return jsonResponse({ ok: true, opted_out: true });
  }

  // ============ 2. Resolver ai_agent_config (do canal, senão padrão do tenant) ============
  const { data: channelConfig } = await adminClient
    .from("ai_agent_configs")
    .select("*")
    .eq("owner_id", conversation.owner_id)
    .eq("channel_id", conversation.channel_id)
    .eq("is_active", true)
    .maybeSingle();

  const config = channelConfig ?? (await adminClient
    .from("ai_agent_configs")
    .select("*")
    .eq("owner_id", conversation.owner_id)
    .is("channel_id", null)
    .eq("is_active", true)
    .maybeSingle()).data;

  if (!config) {
    return jsonResponse({ ok: true, ignored: true, reason: "no active ai_agent_config for this tenant/channel" });
  }

  // ============ 3. Horário comercial ============
  const now = new Date();
  if (!isWithinBusinessHours(config.business_hours, now)) {
    const offHoursText = config.off_hours_message ?? "No momento estamos fora do horário de atendimento. Retornaremos assim que possível.";
    try {
      const provider = getChannelProvider(conversation.channels);
      const result = await provider.sendMessage({ channel: conversation.channels, to: conversation.contacts.phone, contentType: "text", content: offHoursText });
      await adminClient.from("messages").insert({
        conversation_id: conversation.id, direction: "outbound", sender_type: "ai_agent",
        content_type: "text", content: offHoursText, external_message_id: result.externalMessageId, status: "sent",
      });
    } catch (err) {
      console.error("off-hours message send failed", err);
    }
    return jsonResponse({ ok: true, off_hours: true });
  }

  // ============ 4. Base de conhecimento ============
  const { data: knowledgeDocs } = await adminClient
    .from("ai_knowledge_documents")
    .select("content_extracted")
    .eq("ai_agent_config_id", config.id)
    .order("created_at", { ascending: true });

  let knowledgeText = (knowledgeDocs ?? [])
    .map((d) => d.content_extracted)
    .filter((t): t is string => !!t)
    .join("\n\n---\n\n");
  if (knowledgeText.length > MAX_KNOWLEDGE_CHARS) {
    knowledgeText = knowledgeText.slice(0, MAX_KNOWLEDGE_CHARS) + "\n\n[...conteúdo truncado...]";
  }

  // ============ 5. Histórico recente ============
  const { data: historyRows } = await adminClient
    .from("messages")
    .select("direction, sender_type, content, content_type, transcription, is_internal_note")
    .eq("conversation_id", conversation.id)
    .eq("is_internal_note", false)
    .order("sent_at", { ascending: false })
    .limit(HISTORY_LIMIT);

  const history = (historyRows ?? []).slice().reverse();
  const claudeMessages: Anthropic.MessageParam[] = history
    .map((m) => {
      const text = m.content_type === "audio" ? (m.transcription ?? "[áudio sem transcrição disponível]") : (m.content ?? "");
      return {
        role: m.direction === "inbound" ? ("user" as const) : ("assistant" as const),
        content: text,
      };
    })
    .filter((m) => m.content.trim().length > 0);

  if (claudeMessages.length === 0 || claudeMessages[claudeMessages.length - 1].role !== "user") {
    // Sem uma mensagem do cliente para responder (ex: histórico vazio) — nada a fazer.
    return jsonResponse({ ok: true, ignored: true, reason: "no user message to respond to" });
  }

  const interpolatedPrompt = interpolateVariables(config.system_prompt, (config.variables as Record<string, unknown>) ?? {});
  const systemPrompt =
    interpolatedPrompt +
    "\n\nSe o cliente pedir para falar com um atendente humano, ou a pergunta fugir do que você tem informação para responder com segurança, " +
    `comece sua resposta com a tag exata "${HANDOFF_TAG}" seguida de uma frase curta avisando que vai transferir para alguém do time.` +
    (knowledgeText ? `\n\nBase de conhecimento:\n${knowledgeText}` : "");

  // ============ 6. Chamada ao Claude ============
  const anthropic = new Anthropic();
  const claudeResponse = await anthropic.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 1024,
    thinking: { type: "disabled" },
    output_config: { effort: "low" },
    system: systemPrompt,
    messages: claudeMessages,
  });

  const rawText = claudeResponse.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();

  const isHandoff = rawText.startsWith(HANDOFF_TAG);
  const responseText = isHandoff ? rawText.slice(HANDOFF_TAG.length).trim() : rawText;

  if (!responseText) {
    return jsonResponse({ ok: true, ignored: true, reason: "empty model response" });
  }

  // ============ 7. Envio + registro ============
  let externalMessageId: string;
  try {
    const provider = getChannelProvider(conversation.channels);
    const result = await provider.sendMessage({ channel: conversation.channels, to: conversation.contacts.phone, contentType: "text", content: responseText });
    externalMessageId = result.externalMessageId;
  } catch (err) {
    const message = err instanceof ChannelProviderError ? err.message : (err instanceof Error ? err.message : String(err));
    return errorResponse("provider_send_failed", message, 502);
  }

  await adminClient.from("messages").insert({
    conversation_id: conversation.id, direction: "outbound", sender_type: "ai_agent",
    content_type: "text", content: responseText, external_message_id: externalMessageId, status: "sent",
  });

  // Auditoria — critério de aceite: rastrear exatamente qual prompt gerou qual resposta.
  await adminClient.from("activities").insert({
    type: "ai_prompt_audit",
    payload: {
      ai_agent_config_id: config.id,
      model: "claude-sonnet-5",
      system_prompt: systemPrompt,
      messages_sent: claudeMessages,
      response_text: responseText,
      handoff: isHandoff,
    },
    related_to_type: "conversation",
    related_to_id: conversation.id,
  });

  if (isHandoff) {
    await adminClient.from("conversations").update({ ai_paused: true }).eq("id", conversation.id);
    const notifyTarget = conversation.assigned_to ?? conversation.owner_id;
    await adminClient.from("notification").insert({
      user_id: notifyTarget,
      title: "Cliente pediu atendimento humano",
      body: `${conversation.contacts.first_name ?? "Um cliente"} precisa de um atendente. A IA pausou automaticamente.`,
      related_to_type: "conversation",
      related_to_id: conversation.id,
    });
  }

  return jsonResponse({ ok: true, handoff: isHandoff });
});
