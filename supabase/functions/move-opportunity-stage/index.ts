// move-opportunity-stage
//
// Input (JSON body):
//   { opportunity_id: uuid, new_stage_id: uuid }
//
// Auth: Authorization: Bearer <end-user JWT>. Required.
//
// Permissions: none checked in this function's own code — the UPDATE runs
// through a Postgres client scoped to the CALLER's JWT, so RLS
// (is_own(owner_id)) is the actual gate. A caller trying to move an
// opportunity outside her tenant gets 0 rows back, which this function
// turns into a 403 (never a raw DB error, never leaking whether the row
// exists). Module 4's triggers (pipeline/stage validation, closed-status
// block) can still raise real Postgres exceptions — those are surfaced as
// 422.
//
// Note: this used to also support reassigning owner_id (useful in the old
// multi-user-per-org model, e.g. "hand this deal to a teammate"). In the
// multi-tenant model there is exactly one owner per tenant, so that's no
// longer a meaningful operation — removed rather than kept as dead code.
//
// Error format: { error: { code, message } }, non-2xx status.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders, jsonResponse, errorResponse } from "../_shared/cors.ts";

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

  let body: { opportunity_id?: string; new_stage_id?: string };
  try {
    body = await req.json();
  } catch {
    return errorResponse("invalid_json", "Request body must be valid JSON", 400);
  }

  const { opportunity_id, new_stage_id } = body;
  if (!opportunity_id || !UUID_RE.test(opportunity_id)) {
    return errorResponse("invalid_input", "opportunity_id must be a valid UUID", 400);
  }
  if (!new_stage_id || !UUID_RE.test(new_stage_id)) {
    return errorResponse("invalid_input", "new_stage_id must be a valid UUID", 400);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

  // Scoped to the caller's JWT: every query below runs under their RLS.
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: before, error: beforeError } = await userClient
    .from("opportunities")
    .select("id, owner_id")
    .eq("id", opportunity_id)
    .maybeSingle();

  if (beforeError) {
    return errorResponse("query_failed", beforeError.message, 500);
  }
  if (!before) {
    return errorResponse("forbidden", "Opportunity not found or you do not have access to it", 403);
  }

  const { data: updated, error: updateError } = await userClient
    .from("opportunities")
    .update({ stage_id: new_stage_id })
    .eq("id", opportunity_id)
    .select("id, stage_id, owner_id, status, closed_at")
    .maybeSingle();

  if (updateError) {
    // A real business-rule violation from the Module 4 triggers (wrong
    // pipeline, or trying to move a closed opportunity directly).
    return errorResponse("business_rule_violation", updateError.message, 422);
  }
  if (!updated) {
    // RLS silently filtered the UPDATE — shouldn't normally happen since we
    // just read the row above with the same client, but treat it as
    // forbidden rather than a generic 500 if it ever does.
    return errorResponse("forbidden", "You do not have permission to update this opportunity", 403);
  }

  return jsonResponse({ opportunity: updated });
});
