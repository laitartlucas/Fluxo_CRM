// upload-knowledge-document
//
// Input (JSON body):
//   { ai_agent_config_id: uuid, source_type: 'pdf'|'link'|'text', source_url?: string, content?: string, file_base64?: string }
//   - source_type='text': usa `content` direto.
//   - source_type='link': busca `source_url`, extrai texto de um HTML simples.
//   - source_type='pdf':  `file_base64` é o PDF codificado em base64 (sem
//     data: prefix); extraído com `unpdf` (compatível com Deno).
//
// Auth: Authorization: Bearer <end-user JWT>. Required. O insert final
// roda sob o client escopado ao JWT do caller — RLS (ai_knowledge_documents_all,
// via ai_agent_configs.owner_id) garante que só é possível anexar
// documento a um config do próprio tenant.
//
// Extração de PDF/link é best-effort e simples de propósito (sem OCR, sem
// parsing avançado de layout) — documentos escaneados como imagem não
// produzem texto extraível; nesse caso content_extracted fica vazio e o
// documento ainda é salvo (visível na UI para o usuário perceber e trocar
// o arquivo), não é tratado como erro fatal.
//
// Error format: { error: { code, message } }, non-2xx status.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { extractText, getDocumentProxy } from "npm:unpdf";
import { corsHeaders, jsonResponse, errorResponse } from "../_shared/cors.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_EXTRACTED_CHARS = 20000;

interface RequestBody {
  ai_agent_config_id?: string;
  source_type?: "pdf" | "link" | "text";
  source_url?: string;
  content?: string;
  file_base64?: string;
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
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

  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return errorResponse("invalid_json", "Request body must be valid JSON", 400);
  }

  const { ai_agent_config_id: configId, source_type: sourceType } = body;
  if (!configId || !UUID_RE.test(configId)) {
    return errorResponse("invalid_input", "ai_agent_config_id must be a valid UUID", 400);
  }
  if (!sourceType || !["pdf", "link", "text"].includes(sourceType)) {
    return errorResponse("invalid_input", "source_type must be pdf, link or text", 400);
  }

  let contentExtracted = "";
  let sourceUrl: string | null = null;

  try {
    if (sourceType === "text") {
      if (!body.content) return errorResponse("invalid_input", "content is required for source_type=text", 400);
      contentExtracted = body.content;
    } else if (sourceType === "link") {
      if (!body.source_url) return errorResponse("invalid_input", "source_url is required for source_type=link", 400);
      sourceUrl = body.source_url;
      const res = await fetch(body.source_url);
      if (!res.ok) return errorResponse("fetch_failed", `could not fetch source_url (${res.status})`, 502);
      contentExtracted = stripHtml(await res.text());
    } else {
      if (!body.file_base64) return errorResponse("invalid_input", "file_base64 is required for source_type=pdf", 400);
      const bytes = base64ToUint8Array(body.file_base64);
      const pdf = await getDocumentProxy(bytes);
      const { text } = await extractText(pdf, { mergePages: true });
      contentExtracted = text;
    }
  } catch (err) {
    return errorResponse("extraction_failed", err instanceof Error ? err.message : String(err), 422);
  }

  if (contentExtracted.length > MAX_EXTRACTED_CHARS) {
    contentExtracted = contentExtracted.slice(0, MAX_EXTRACTED_CHARS);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: inserted, error: insertError } = await userClient
    .from("ai_knowledge_documents")
    .insert({
      ai_agent_config_id: configId,
      source_type: sourceType,
      source_url: sourceUrl,
      content_extracted: contentExtracted,
    })
    .select("id, source_type, source_url, created_at")
    .single();

  if (insertError) {
    // RLS bloqueando (config de outro tenant) aparece aqui como erro de
    // policy violation — tratado como forbidden, não como 500 genérico.
    const status = insertError.code === "42501" ? 403 : 500;
    return errorResponse(status === 403 ? "forbidden" : "query_failed", insertError.message, status);
  }

  return jsonResponse({ document: inserted, content_length: contentExtracted.length });
});
