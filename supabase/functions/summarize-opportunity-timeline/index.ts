// summarize-opportunity-timeline
//
// Input (JSON body): { opportunity_id: uuid }
// Auth: Authorization: Bearer <end-user JWT>. Required.
//
// Permissions: none checked in this function's own code — the opportunity
// fetch and the timeline RPC both run through a client scoped to the
// CALLER's JWT, so Module 3's RLS is the real gate (403 if not visible).
// Only after that succeeds does the function touch the cache/Claude with
// the service role.
//
// Data sent to Claude: ONLY this one opportunity's own fields (name,
// value, stage, status) and its own timeline (activity type/payload/date,
// task titles/status/date). Nothing about other records, other users
// beyond names already visible to the caller via RLS, or unrelated data.
//
// Caching: opportunity_summary_cache holds one row per opportunity. A
// cached summary is reused as-is whenever its last_activity_at is still
// >= the timeline's current latest activity — i.e. nothing new happened
// since it was generated. This is a read-time staleness check, not a
// trigger-based invalidation, which keeps the cache table itself simple.
//
// Cost/frequency: at most one Claude call per opportunity per NEW
// activity (not per page view) — most calls after the first for a given
// deal are cache hits and cost nothing. effort is set to "low" since this
// is a short summarization task, not a reasoning-heavy one.
//
// Error format: { error: { code, message } }, non-2xx status.
// Success format: { summary: string, cached: boolean, activity_count: number }

import Anthropic from "npm:@anthropic-ai/sdk";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders, jsonResponse, errorResponse } from "../_shared/cors.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface TimelineRow {
  kind: "activity" | "task";
  id: string;
  occurred_at: string;
  activity_type: string;
  title: string | null;
  payload: Record<string, unknown>;
  actor_id: string | null;
}

function describeRow(row: TimelineRow): string {
  const date = new Date(row.occurred_at).toISOString().slice(0, 16).replace("T", " ");
  if (row.kind === "task") {
    return `[${date}] Tarefa "${row.title}" — status: ${row.activity_type}`;
  }
  switch (row.activity_type) {
    case "stage_change": {
      const p = row.payload as { from_stage_name?: string; to_stage_name?: string };
      return p.from_stage_name
        ? `[${date}] Mudou de estágio: ${p.from_stage_name} -> ${p.to_stage_name}`
        : `[${date}] Criada no estágio: ${p.to_stage_name}`;
    }
    case "field_update": {
      const p = row.payload as { field?: string; old_value?: unknown; new_value?: unknown };
      return `[${date}] Campo "${p.field}" alterado: ${p.old_value} -> ${p.new_value}`;
    }
    case "task_completed": {
      const p = row.payload as { title?: string };
      return `[${date}] Tarefa concluída: ${p.title}`;
    }
    case "opportunity_reopened": {
      const p = row.payload as { reason?: string; previous_status?: string };
      return `[${date}] Reaberta (estava ${p.previous_status}). Motivo: ${p.reason}`;
    }
    default:
      return `[${date}] ${row.activity_type}: ${JSON.stringify(row.payload)}`;
  }
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

  let body: { opportunity_id?: string };
  try {
    body = await req.json();
  } catch {
    return errorResponse("invalid_json", "Request body must be valid JSON", 400);
  }

  const opportunityId = body.opportunity_id;
  if (!opportunityId || !UUID_RE.test(opportunityId)) {
    return errorResponse("invalid_input", "opportunity_id must be a valid UUID", 400);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: opportunity, error: oppError } = await userClient
    .from("opportunities")
    .select("id, name, value, currency, status")
    .eq("id", opportunityId)
    .maybeSingle();
  if (oppError) {
    return errorResponse("query_failed", oppError.message, 500);
  }
  if (!opportunity) {
    return errorResponse("forbidden", "Opportunity not found or you do not have access to it", 403);
  }

  const { data: stageRow } = await userClient
    .from("opportunities")
    .select("pipeline_stages(name)")
    .eq("id", opportunityId)
    .maybeSingle<{ pipeline_stages: { name: string } | null }>();
  const stageName = stageRow?.pipeline_stages?.name ?? "desconhecido";

  const { data: timeline, error: timelineError } = await userClient.rpc("get_timeline", {
    p_related_to_type: "opportunity",
    p_related_to_id: opportunityId,
  });
  if (timelineError) {
    return errorResponse("query_failed", timelineError.message, 500);
  }

  const rows = (timeline ?? []) as TimelineRow[];
  if (rows.length === 0) {
    return jsonResponse({ summary: "Nenhuma atividade registrada ainda para esta oportunidade.", cached: false, activity_count: 0 });
  }

  const latestActivityAt = rows.reduce((max, r) => (r.occurred_at > max ? r.occurred_at : max), rows[0].occurred_at);

  const adminClient = createClient(supabaseUrl, serviceRoleKey);
  const { data: cached } = await adminClient
    .from("opportunity_summary_cache")
    .select("summary, activity_count, last_activity_at")
    .eq("opportunity_id", opportunityId)
    .maybeSingle();

  if (cached && cached.last_activity_at && cached.last_activity_at >= latestActivityAt) {
    return jsonResponse({ summary: cached.summary, cached: true, activity_count: cached.activity_count });
  }

  const timelineText = rows
    .slice()
    .sort((a, b) => a.occurred_at.localeCompare(b.occurred_at))
    .map(describeRow)
    .join("\n");

  const anthropic = new Anthropic();
  const message = await anthropic.messages.create({
    model: "claude-opus-5",
    max_tokens: 512,
    output_config: { effort: "low" },
    system:
      "Você resume o histórico de um negócio de vendas (CRM) para um vendedor ou gestor que vai reler isso rapidamente antes de uma ligação. " +
      "Escreva em português, em no máximo 4 frases curtas, cobrindo: situação atual, principais marcos e qualquer sinal de atenção (ex: muito tempo parado, reaberto, muitas trocas de dono). " +
      "Não invente informação que não esteja no histórico fornecido.",
    messages: [
      {
        role: "user",
        content:
          `Oportunidade: ${opportunity.name}\n` +
          `Valor: ${opportunity.value} ${opportunity.currency}\n` +
          `Estágio atual: ${stageName}\n` +
          `Status: ${opportunity.status}\n\n` +
          `Histórico (mais antigo primeiro):\n${timelineText}`,
      },
    ],
  });

  const summaryText = message.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();

  await adminClient.from("opportunity_summary_cache").upsert({
    opportunity_id: opportunityId,
    summary: summaryText,
    activity_count: rows.length,
    last_activity_at: latestActivityAt,
    generated_at: new Date().toISOString(),
  });

  return jsonResponse({ summary: summaryText, cached: false, activity_count: rows.length });
});
