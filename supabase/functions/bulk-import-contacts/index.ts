// bulk-import-contacts
//
// Input (JSON body):
//   { contacts: [{ first_name, last_name?, email?, phone?, job_title?, company_id? }] }
//   Max 500 contacts per call. All imported contacts belong to the caller
//   (there's exactly one owner per tenant in the multi-tenant model, so
//   there's no one else within her account to assign contacts to).
//
// Auth: Authorization: Bearer <end-user JWT>. Required.
//
// Permissions: no separate check here — inserts run through a client
// scoped to the CALLER's JWT, so Module 3's RLS (contacts:insert +
// is_own(owner_id)) is the real gate, exactly like move-opportunity-stage.
// owner_id defaults to the caller when omitted; if the caller passes a
// different owner_id without team/all insert scope, RLS rejects those rows
// individually (reported per-row, not a blanket failure).
//
// Duplicate handling: an incoming row is skipped (not inserted, not
// upserted) if its email (case-insensitive) already matches an existing,
// non-deleted contact. Rows without an email are never treated as
// duplicates of each other.
//
// Rate limit: 5 calls/hour/caller (public.check_rate_limit) — this guards
// against runaway/looping scripts, not against a single legitimate big
// import (which the 500-row cap already bounds).
//
// Error format: { error: { code, message } }, non-2xx status.
// Success format: { inserted: number, skipped_duplicates: string[], failed: [{ index, reason }] }

import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders, jsonResponse, errorResponse } from "../_shared/cors.ts";

const MAX_ROWS = 500;

interface ContactInput {
  first_name?: string;
  last_name?: string;
  email?: string;
  phone?: string;
  job_title?: string;
  company_id?: string;
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

  let body: { contacts?: ContactInput[] };
  try {
    body = await req.json();
  } catch {
    return errorResponse("invalid_json", "Request body must be valid JSON", 400);
  }

  const contacts = body.contacts;
  if (!Array.isArray(contacts) || contacts.length === 0) {
    return errorResponse("invalid_input", "contacts must be a non-empty array", 400);
  }
  if (contacts.length > MAX_ROWS) {
    return errorResponse("invalid_input", `contacts cannot exceed ${MAX_ROWS} rows per call`, 400);
  }
  for (let i = 0; i < contacts.length; i++) {
    if (!contacts[i].first_name || !contacts[i].first_name!.trim()) {
      return errorResponse("invalid_input", `contacts[${i}].first_name is required`, 400);
    }
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  const { data: { user: caller } } = await userClient.auth.getUser();
  if (!caller) {
    return errorResponse("unauthenticated", "Invalid or expired token", 401);
  }

  const { data: withinLimit, error: rateLimitError } = await adminClient.rpc("check_rate_limit", {
    p_user_id: caller.id,
    p_endpoint: "bulk-import-contacts",
    p_max_per_window: 5,
  });
  if (rateLimitError) {
    return errorResponse("query_failed", rateLimitError.message, 500);
  }
  if (!withinLimit) {
    return errorResponse("rate_limited", "Too many bulk imports this hour. Try again later.", 429);
  }

  const emails = contacts
    .map((c) => c.email?.trim().toLowerCase())
    .filter((e): e is string => Boolean(e));

  const existingEmails = new Set<string>();
  if (emails.length > 0) {
    // Uses the caller's own client: only counts as "duplicate" the
    // contacts this caller can actually see, which is the correct scope
    // for "should I insert this" from their point of view.
    const { data: existing, error: lookupError } = await userClient
      .from("contacts")
      .select("email")
      .in("email", emails)
      .is("deleted_at", null);
    if (lookupError) {
      return errorResponse("query_failed", lookupError.message, 500);
    }
    for (const row of existing ?? []) {
      if (row.email) existingEmails.add(row.email.toLowerCase());
    }
  }

  const ownerId = caller.id;
  const skippedDuplicates: string[] = [];
  const toInsert: Record<string, unknown>[] = [];
  const insertIndexes: number[] = [];

  contacts.forEach((c, i) => {
    const email = c.email?.trim().toLowerCase();
    if (email && existingEmails.has(email)) {
      skippedDuplicates.push(email);
      return;
    }
    toInsert.push({
      first_name: c.first_name!.trim(),
      last_name: c.last_name?.trim() || null,
      email: c.email?.trim() || null,
      phone: c.phone?.trim() || null,
      job_title: c.job_title?.trim() || null,
      company_id: c.company_id || null,
      owner_id: ownerId,
    });
    insertIndexes.push(i);
    if (email) existingEmails.add(email); // catch duplicates within the same payload
  });

  const failed: { index: number; reason: string }[] = [];
  let insertedCount = 0;

  if (toInsert.length > 0) {
    // Row-by-row so one RLS/validation failure doesn't abort the whole
    // batch, and so we can report exactly which rows failed and why.
    for (let j = 0; j < toInsert.length; j++) {
      const { error } = await userClient.from("contacts").insert(toInsert[j]);
      if (error) {
        failed.push({ index: insertIndexes[j], reason: error.message });
      } else {
        insertedCount++;
      }
    }
  }

  return jsonResponse({
    inserted: insertedCount,
    skipped_duplicates: skippedDuplicates,
    failed,
  });
});
