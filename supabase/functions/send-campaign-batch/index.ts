// send-campaign-batch
//
// Input (JSON body):
//   { type: 'campaign', campaign_id: uuid }   — lote de uma campanha agendada
//   { type: 'followup', campaign_recipient_id: uuid, followup_rule_id: uuid } — um follow-up vencido
//
// Auth: chamada só pelo pg_cron (via pg_net, ver run_scheduled_campaigns em
// 0041_campaign_send_engine.sql) com o service_role JWT. Nunca pelo
// frontend — criar/agendar uma campanha é uma operação direta de tabela
// (RLS normal), só o ENVIO em si passa por aqui.
//
// Rate limit: MAX_SENDS_PER_MINUTE é um teto conservador por canal, não um
// número documentado pelo Evolution API/Instagram — ajustar por
// canal/plano quando houver dado real de throttling. Cada envio consome
// uma unidade de channel_send_rate_limit (0041); quando o limite do minuto
// estoura, o restante do lote fica 'pending' e é pego no próximo tick do
// cron (a cada minuto) — a fila segura o excesso em vez de estourar erro
// do provedor.
//
// LGPD (critério de aceite do adendo): TODO envio — de campanha e de
// follow-up — refiltra opted_out_at is null aqui, mesmo que a lista já
// devesse ter sido filtrada na criação da campanha (defesa em profundidade,
// não confiar só no filtro de audiência do frontend).
//
// Error format: { error: { code, message } }, non-2xx status.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { getChannelProvider, ChannelProviderError, type ChannelRow } from "../_shared/channel-provider.ts";

const MAX_SENDS_PER_MINUTE = 10;
const BATCH_SIZE = 20;

interface RequestBody {
  type?: "campaign" | "followup";
  campaign_id?: string;
  campaign_recipient_id?: string;
  followup_rule_id?: string;
}

function renderTemplate(body: string, contact: { first_name: string; last_name: string | null }, companyName: string | null): string {
  return body
    .replace(/\{\{\s*nome\s*\}\}/gi, contact.first_name)
    .replace(/\{\{\s*empresa\s*\}\}/gi, companyName ?? "");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return errorResponse("method_not_allowed", "Use POST", 405);
  }

  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return errorResponse("invalid_json", "Request body must be valid JSON", 400);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  if (body.type === "campaign") {
    return await processCampaignBatch(adminClient, body.campaign_id);
  }
  if (body.type === "followup") {
    return await processFollowup(adminClient, body.campaign_recipient_id, body.followup_rule_id);
  }
  return errorResponse("invalid_input", "type must be 'campaign' or 'followup'", 400);
});

// deno-lint-ignore no-explicit-any
async function processCampaignBatch(adminClient: any, campaignId?: string) {
  if (!campaignId) return errorResponse("invalid_input", "campaign_id is required", 400);

  const { data: campaign, error: campaignError } = await adminClient
    .from("campaigns")
    .select("id, owner_id, channel_id, template_id, channels(id, owner_id, type, provider, phone_number, external_account_id, credential_ref), campaign_templates(id, body)")
    .eq("id", campaignId)
    .maybeSingle();

  if (campaignError) return errorResponse("query_failed", campaignError.message, 500);
  if (!campaign || !campaign.campaign_templates) {
    return jsonResponse({ ok: true, ignored: true, reason: "campaign or template not found" });
  }

  const { data: recipients, error: recError } = await adminClient
    .from("campaign_recipients")
    .select("id, contact_id, contacts(id, first_name, last_name, phone, opted_out_at, company_id, companies(name))")
    .eq("campaign_id", campaignId)
    .eq("status", "pending")
    .limit(BATCH_SIZE);

  if (recError) return errorResponse("query_failed", recError.message, 500);

  const channel: ChannelRow = campaign.channels;
  const provider = getChannelProvider(channel);
  let sent = 0;
  let skippedOptedOut = 0;
  let rateLimited = false;

  for (const recipient of recipients ?? []) {
    const contact = recipient.contacts;
    if (!contact?.phone) continue;

    if (contact.opted_out_at) {
      await adminClient.from("campaign_recipients").update({ status: "opted_out" }).eq("id", recipient.id);
      skippedOptedOut++;
      continue;
    }

    const { data: withinLimit } = await adminClient.rpc("check_channel_send_rate_limit", {
      p_channel_id: channel.id,
      p_max_per_minute: MAX_SENDS_PER_MINUTE,
    });
    if (!withinLimit) {
      rateLimited = true;
      break; // resto fica 'pending' — o próximo tick do cron (1 min) continua
    }

    const text = renderTemplate(campaign.campaign_templates.body, contact, contact.companies?.name ?? null);
    try {
      await provider.sendMessage({ channel, to: contact.phone, contentType: "text", content: text });
      await adminClient.from("campaign_recipients").update({ status: "sent", sent_at: new Date().toISOString() }).eq("id", recipient.id);
      sent++;
    } catch (err) {
      const message = err instanceof ChannelProviderError ? err.message : (err instanceof Error ? err.message : String(err));
      console.error(`campaign ${campaignId} recipient ${recipient.id} send failed: ${message}`);
      await adminClient.from("campaign_recipients").update({ status: "failed" }).eq("id", recipient.id);
    }
  }

  if (!rateLimited) {
    const { count: remaining } = await adminClient
      .from("campaign_recipients")
      .select("id", { count: "exact", head: true })
      .eq("campaign_id", campaignId)
      .eq("status", "pending");
    if ((remaining ?? 0) === 0) {
      await adminClient.from("campaigns").update({ status: "completed" }).eq("id", campaignId);
    }
  }

  return jsonResponse({ ok: true, sent, skipped_opted_out: skippedOptedOut, rate_limited: rateLimited });
}

// deno-lint-ignore no-explicit-any
async function processFollowup(adminClient: any, recipientId?: string, ruleId?: string) {
  if (!recipientId || !ruleId) return errorResponse("invalid_input", "campaign_recipient_id and followup_rule_id are required", 400);

  const { data: recipient, error: recError } = await adminClient
    .from("campaign_recipients")
    .select("id, campaign_id, contacts(id, first_name, last_name, phone, opted_out_at, company_id, companies(name)), campaigns(channel_id, channels(id, owner_id, type, provider, phone_number, external_account_id, credential_ref))")
    .eq("id", recipientId)
    .maybeSingle();
  const { data: rule, error: ruleError } = await adminClient
    .from("campaign_followup_rules")
    .select("id, message_template_id, campaign_templates(body)")
    .eq("id", ruleId)
    .maybeSingle();

  if (recError || ruleError) return errorResponse("query_failed", (recError ?? ruleError)!.message, 500);
  if (!recipient || !rule?.campaign_templates) {
    return jsonResponse({ ok: true, ignored: true, reason: "recipient or followup template not found" });
  }

  const contact = recipient.contacts;
  if (!contact?.phone || contact.opted_out_at) {
    return jsonResponse({ ok: true, ignored: true, reason: "contact opted out or has no address" });
  }

  const channel: ChannelRow = recipient.campaigns.channels;
  const { data: withinLimit } = await adminClient.rpc("check_channel_send_rate_limit", {
    p_channel_id: channel.id,
    p_max_per_minute: MAX_SENDS_PER_MINUTE,
  });
  if (!withinLimit) {
    // Follow-up individual: sem "fila" própria — o cron tenta de novo no
    // próximo tick porque campaign_followup_log só é gravado em caso de sucesso.
    return jsonResponse({ ok: true, rate_limited: true });
  }

  const text = renderTemplate(rule.campaign_templates.body, contact, contact.companies?.name ?? null);
  try {
    const provider = getChannelProvider(channel);
    await provider.sendMessage({ channel, to: contact.phone, contentType: "text", content: text });
  } catch (err) {
    const message = err instanceof ChannelProviderError ? err.message : (err instanceof Error ? err.message : String(err));
    return errorResponse("provider_send_failed", message, 502);
  }

  await adminClient.from("campaign_followup_log").insert({ campaign_recipient_id: recipientId, followup_rule_id: ruleId });

  return jsonResponse({ ok: true, sent: true });
}
