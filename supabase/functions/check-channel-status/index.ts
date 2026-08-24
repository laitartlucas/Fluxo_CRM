// check-channel-status
//
// Input (JSON body):
//   { channel_id: uuid }
//
// Auth: Authorization: Bearer <end-user JWT>. Required.
//
// Usado pela tela Contas para o botão "Reconectar" (e para checar status
// sob demanda em geral) — chama ChannelProvider.getConnectionStatus, que
// bate direto no provedor (Evolution API / Instagram Graph API), e grava o
// resultado em channels.status/quality_rating/connected_at. Mesmo padrão de
// move-opportunity-stage: a query roda sob o JWT do chamador, então RLS
// (is_own(owner_id)) já impede checar/atualizar canal de outro tenant.
//
// Error format: { error: { code, message } }, non-2xx status.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { getChannelProvider, ChannelProviderError, type ChannelRow } from "../_shared/channel-provider.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

  let body: { channel_id?: string };
  try {
    body = await req.json();
  } catch {
    return errorResponse("invalid_json", "Request body must be valid JSON", 400);
  }

  const { channel_id } = body;
  if (!channel_id || !UUID_RE.test(channel_id)) {
    return errorResponse("invalid_input", "channel_id must be a valid UUID", 400);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: channel, error: fetchError } = await userClient
    .from("channels")
    .select("id, owner_id, type, provider, phone_number, external_account_id, credential_ref, status")
    .eq("id", channel_id)
    .maybeSingle();

  if (fetchError) {
    return errorResponse("query_failed", fetchError.message, 500);
  }
  if (!channel) {
    return errorResponse("forbidden", "Channel not found or you do not have access to it", 403);
  }

  let result: { status: string; qualityRating?: string };
  try {
    const provider = getChannelProvider(channel as ChannelRow);
    result = await provider.getConnectionStatus(channel as ChannelRow);
  } catch (err) {
    if (err instanceof ChannelProviderError) {
      return errorResponse("provider_error", err.message, 502);
    }
    return errorResponse("provider_error", err instanceof Error ? err.message : String(err), 502);
  }

  const wasConnected = channel.status === "connected";
  const nowConnected = result.status === "connected";

  const { data: updated, error: updateError } = await userClient
    .from("channels")
    .update({
      status: result.status,
      quality_rating: result.qualityRating ?? null,
      connected_at: nowConnected && !wasConnected ? new Date().toISOString() : undefined,
    })
    .eq("id", channel_id)
    .select("id, status, quality_rating, connected_at")
    .maybeSingle();

  if (updateError) {
    return errorResponse("update_failed", updateError.message, 500);
  }

  return jsonResponse({ channel: updated });
});
