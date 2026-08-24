import { supabase } from './supabase'
import type { DashboardSummary } from './types'

export class ApiError extends Error {
  code: string
  status: number
  constructor(code: string, message: string, status: number) {
    super(message)
    this.code = code
    this.status = status
  }
}

// supabase.functions.invoke() attaches the current session's JWT
// automatically and does NOT throw on non-2xx — it returns { data, error }.
// We normalize that into a thrown ApiError so callers can just try/catch,
// and unpack our Edge Functions' { error: { code, message } } body shape.
async function invoke<T>(name: string, body?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body })

  if (error) {
    const context = (error as { context?: Response }).context
    let parsed: { error?: { code?: string; message?: string } } | null = null
    if (context) {
      try {
        parsed = await context.clone().json()
      } catch {
        // response body wasn't JSON — fall through to generic message
      }
    }
    throw new ApiError(
      parsed?.error?.code ?? 'unknown_error',
      parsed?.error?.message ?? error.message,
      context?.status ?? 500
    )
  }

  return data as T
}

export function moveOpportunityStage(opportunityId: string, newStageId: string) {
  return invoke<{ opportunity: { id: string; stage_id: string; owner_id: string; status: string; closed_at: string | null } }>(
    'move-opportunity-stage',
    { opportunity_id: opportunityId, new_stage_id: newStageId }
  )
}

export function inviteMember(email: string, fullName?: string, businessName?: string) {
  return invoke<{ user_id: string; email: string; pipeline_id: string }>('invite-member', {
    email,
    full_name: fullName,
    business_name: businessName,
  })
}

export interface BulkImportContactRow {
  first_name: string
  last_name?: string
  email?: string
  phone?: string
  job_title?: string
  company_id?: string
}

export function bulkImportContacts(contacts: BulkImportContactRow[]) {
  return invoke<{ inserted: number; skipped_duplicates: string[]; failed: { index: number; reason: string }[] }>(
    'bulk-import-contacts',
    { contacts }
  )
}

export function getDashboardSummary() {
  return invoke<DashboardSummary>('get-dashboard-summary')
}

export function summarizeOpportunityTimeline(opportunityId: string) {
  return invoke<{ summary: string; cached: boolean; activity_count: number }>(
    'summarize-opportunity-timeline',
    { opportunity_id: opportunityId }
  )
}

// ============ Comunicação Omnichannel (adendo) ============
// Os webhooks e o motor de disparo (send-campaign-batch) nunca são
// chamados a partir do frontend — só estas duas, que precisam do JWT do
// usuário logado (envio manual do inbox / upload de base de conhecimento).

export function sendConversationMessage(
  conversationId: string,
  content: string,
  contentType: 'text' | 'image' | 'audio' | 'video' | 'document' = 'text'
) {
  return invoke<{ message: { id: string; sent_at: string } }>('send-conversation-message', {
    conversation_id: conversationId,
    content,
    content_type: contentType,
  })
}

export function checkChannelStatus(channelId: string) {
  return invoke<{ channel: { id: string; status: string; quality_rating: string | null; connected_at: string | null } }>(
    'check-channel-status',
    { channel_id: channelId }
  )
}

export function uploadKnowledgeDocument(params: {
  aiAgentConfigId: string
  sourceType: 'pdf' | 'link' | 'text'
  sourceUrl?: string
  content?: string
  fileBase64?: string
}) {
  return invoke<{ document: { id: string; source_type: string; source_url: string | null; created_at: string }; content_length: number }>(
    'upload-knowledge-document',
    {
      ai_agent_config_id: params.aiAgentConfigId,
      source_type: params.sourceType,
      source_url: params.sourceUrl,
      content: params.content,
      file_base64: params.fileBase64,
    }
  )
}
