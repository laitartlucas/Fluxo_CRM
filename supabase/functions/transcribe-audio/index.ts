// transcribe-audio
//
// Input (JSON body): { conversation_id: uuid, external_message_id: string, media_url: string }
// Auth: interna (service_role) — despachada fire-and-forget pelos webhooks
// de recebimento quando content_type = 'audio', para não bloquear o
// recebimento da mensagem esperando a transcrição terminar.
//
// Sem equivalente Claude a Whisper (não existe endpoint de transcrição de
// áudio na API da Anthropic) — usa a Whisper API da OpenAI (whisper-1) como
// provider dedicado só para isso. Requer o secret OPENAI_API_KEY.
//
// Atualiza messages.transcription pelo external_message_id (não pelo id —
// esta function só recebe o que o webhook já tinha à mão).
//
// Error format: { error: { code, message } }, non-2xx status.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders, jsonResponse, errorResponse } from "../_shared/cors.ts";

interface RequestBody {
  conversation_id?: string;
  external_message_id?: string;
  media_url?: string;
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
  if (!body.external_message_id || !body.media_url) {
    return errorResponse("invalid_input", "external_message_id and media_url are required", 400);
  }

  const openaiKey = Deno.env.get("OPENAI_API_KEY");
  if (!openaiKey) {
    return errorResponse("misconfigured", "OPENAI_API_KEY not set for this Edge Functions project", 500);
  }

  const mediaRes = await fetch(body.media_url);
  if (!mediaRes.ok) {
    return errorResponse("media_fetch_failed", `could not download audio from media_url (${mediaRes.status})`, 502);
  }
  const audioBlob = await mediaRes.blob();

  const form = new FormData();
  form.append("file", audioBlob, "audio.ogg");
  form.append("model", "whisper-1");

  const whisperRes = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${openaiKey}` },
    body: form,
  });

  if (!whisperRes.ok) {
    const text = await whisperRes.text().catch(() => "");
    return errorResponse("transcription_failed", `Whisper API error: ${whisperRes.status} ${text}`, 502);
  }

  const { text: transcription } = (await whisperRes.json()) as { text: string };

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  const { error: updateError } = await adminClient
    .from("messages")
    .update({ transcription })
    .eq("external_message_id", body.external_message_id);

  if (updateError) {
    return errorResponse("query_failed", updateError.message, 500);
  }

  return jsonResponse({ ok: true, transcription });
});
