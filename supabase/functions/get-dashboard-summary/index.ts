// get-dashboard-summary
//
// Input: none (GET or POST, no body needed).
//
// Auth: Authorization: Bearer <end-user JWT>. Required.
//
// Permissions: none checked in this function — every query below runs
// through a client scoped to the CALLER's JWT, so results are already
// exactly what Module 3's RLS would return for them individually. This
// function's only job is bundling 3 round-trips into 1.
//
// Returns:
//   {
//     forecast: { total_value, weighted_forecast, opportunity_count },
//     pending_tasks: [{ id, title, due_at, status }] (up to 10, soonest due first),
//     recent_activities: [{ id, type, payload, created_at, related_to_type, related_to_id }] (up to 15, newest first)
//   }
//
// Error format: { error: { code, message } }, non-2xx status.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders, jsonResponse, errorResponse } from "../_shared/cors.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return errorResponse("unauthenticated", "Missing Authorization header", 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const [forecastRes, tasksRes, activitiesRes] = await Promise.all([
    userClient.from("opportunity_forecast").select("total_value, weighted_forecast, opportunity_count"),
    userClient
      .from("tasks")
      .select("id, title, due_at, status")
      .neq("status", "done")
      .neq("status", "cancelled")
      .order("due_at", { ascending: true, nullsFirst: false })
      .limit(10),
    userClient
      .from("activities")
      .select("id, type, payload, created_at, related_to_type, related_to_id")
      .order("created_at", { ascending: false })
      .limit(15),
  ]);

  if (forecastRes.error) return errorResponse("query_failed", forecastRes.error.message, 500);
  if (tasksRes.error) return errorResponse("query_failed", tasksRes.error.message, 500);
  if (activitiesRes.error) return errorResponse("query_failed", activitiesRes.error.message, 500);

  const forecastTotals = (forecastRes.data ?? []).reduce(
    (acc, row) => ({
      total_value: acc.total_value + Number(row.total_value ?? 0),
      weighted_forecast: acc.weighted_forecast + Number(row.weighted_forecast ?? 0),
      opportunity_count: acc.opportunity_count + Number(row.opportunity_count ?? 0),
    }),
    { total_value: 0, weighted_forecast: 0, opportunity_count: 0 }
  );

  return jsonResponse({
    forecast: forecastTotals,
    pending_tasks: tasksRes.data ?? [],
    recent_activities: activitiesRes.data ?? [],
  });
});
