// invite-member
//
// Input (JSON body):
//   { email: string, full_name?: string, business_name?: string }
//
// Auth: Authorization: Bearer <end-user JWT>. Required.
//
// Permissions: caller must be a platform admin (public.users.is_platform_admin).
// Checked via an RPC to is_platform_admin(), using a client scoped to the
// CALLER's JWT — this function does not just trust a client-supplied flag.
//
// Side effects (multi-tenant model — each invite provisions a whole new,
// fully isolated tenant, not a role inside a shared org):
//   - Creates the auth.users row via Supabase Auth's admin inviteUserByEmail
//     (sends the actual invite email). Triggers Module 2's
//     handle_new_auth_user, populating public.users.
//   - Creates a default pipeline ("Funil Principal") + 5 starter stages
//     owned by the new user, so she isn't dropped into an empty Kanban.
//   - All of this runs with the SERVICE ROLE client (auth.uid() = null),
//     the same trusted-backend path prevent_self_escalation already
//     allows through.
//
// Rate limit: 20 invites/hour/caller (public.check_rate_limit), returns 429.
//
// Error format: { error: { code, message } }, non-2xx status.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders, jsonResponse, errorResponse } from "../_shared/cors.ts";

// Every row needs the same keys: PostgREST's bulk insert sends an explicit
// NULL for any column a row omits that a sibling row in the same array
// includes, rather than letting the column default apply.
const DEFAULT_STAGES = [
  { name: "Qualificação", display_order: 1, probability: 10, is_won: false, is_lost: false },
  { name: "Proposta", display_order: 2, probability: 40, is_won: false, is_lost: false },
  { name: "Negociação", display_order: 3, probability: 70, is_won: false, is_lost: false },
  { name: "Fechado Ganho", display_order: 4, probability: 100, is_won: true, is_lost: false },
  { name: "Fechado Perdido", display_order: 5, probability: 0, is_won: false, is_lost: true },
];

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

  let body: { email?: string; full_name?: string; business_name?: string };
  try {
    body = await req.json();
  } catch {
    return errorResponse("invalid_json", "Request body must be valid JSON", 400);
  }

  const { email, full_name, business_name } = body;
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return errorResponse("invalid_input", "A valid email is required", 400);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: isAdmin, error: permError } = await userClient.rpc("is_platform_admin");
  if (permError) {
    return errorResponse("query_failed", permError.message, 500);
  }
  if (!isAdmin) {
    return errorResponse("forbidden", "Only a platform admin can invite new accounts", 403);
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  const { data: { user: caller } } = await userClient.auth.getUser();
  const { data: withinLimit, error: rateLimitError } = await adminClient.rpc("check_rate_limit", {
    p_user_id: caller!.id,
    p_endpoint: "invite-member",
    p_max_per_window: 20,
  });
  if (rateLimitError) {
    return errorResponse("query_failed", rateLimitError.message, 500);
  }
  if (!withinLimit) {
    return errorResponse("rate_limited", "Too many invites sent this hour. Try again later.", 429);
  }

  const { data: invited, error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(email, {
    data: { full_name, business_name },
  });
  if (inviteError) {
    const status = inviteError.status === 422 || /already registered/i.test(inviteError.message) ? 409 : 500;
    return errorResponse("invite_failed", inviteError.message, status);
  }

  const newUserId = invited.user.id;

  const { data: pipeline, error: pipelineError } = await adminClient
    .from("pipelines")
    .insert({ name: "Funil Principal", owner_id: newUserId })
    .select("id")
    .single();
  if (pipelineError) {
    return errorResponse("provisioning_failed", pipelineError.message, 500);
  }

  const { error: stagesError } = await adminClient
    .from("pipeline_stages")
    .insert(DEFAULT_STAGES.map((s) => ({ ...s, pipeline_id: pipeline.id })));
  if (stagesError) {
    return errorResponse("provisioning_failed", stagesError.message, 500);
  }

  return jsonResponse({ user_id: newUserId, email, pipeline_id: pipeline.id }, 201);
});
