export interface AppUser {
  id: string
  email: string
  full_name: string | null
  is_active: boolean
  is_platform_admin: boolean
}

export type Channel = 'instagram' | 'indicacao' | 'anuncios' | 'site' | 'whatsapp' | 'outro'

export interface Campaign {
  id: string
  owner_id: string
  name: string
  channel: Channel
  goal: string | null
  status: 'active' | 'paused'
}

export type PaymentMethod = 'pix' | 'cartao' | 'boleto' | 'dinheiro' | 'transferencia' | 'outro'

export interface Charge {
  id: string
  owner_id: string
  contact_id: string
  description: string
  value: number
  due_date: string
  payment_method: PaymentMethod
  status: 'proposed' | 'pending' | 'paid'
  paid_at: string | null
}

export interface Appointment {
  id: string
  owner_id: string
  title: string
  description: string | null
  start_at: string
  end_at: string | null
  related_to_type: 'company' | 'contact' | 'opportunity' | null
  related_to_id: string | null
  reminder_minutes_before: number
  reminded_at: string | null
}

export interface Company {
  id: string
  name: string
  domain: string | null
  phone: string | null
  address: string | null
  notes: string | null
  owner_id: string
  deleted_at: string | null
  created_at: string
  updated_at: string
}

export interface Contact {
  id: string
  company_id: string | null
  first_name: string
  last_name: string | null
  email: string | null
  phone: string | null
  job_title: string | null
  notes: string | null
  source: string | null
  campaign_id: string | null
  owner_id: string
  deleted_at: string | null
  created_at: string
  updated_at: string
}

export interface Pipeline {
  id: string
  name: string
  is_active: boolean
}

export interface PipelineStage {
  id: string
  pipeline_id: string
  name: string
  display_order: number
  probability: number
  is_won: boolean
  is_lost: boolean
}

export interface Opportunity {
  id: string
  name: string
  pipeline_id: string
  stage_id: string
  company_id: string | null
  primary_contact_id: string | null
  owner_id: string
  value: number
  currency: string
  status: 'open' | 'won' | 'lost'
  expected_close_date: string | null
  closed_at: string | null
  health: 'saudavel' | 'atencao' | 'risco' | null
  next_action_at: string | null
  next_action_note: string | null
  created_at: string
  updated_at: string
}

export interface TaskItem {
  id: string
  title: string
  description: string | null
  due_at: string | null
  status: 'pending' | 'in_progress' | 'done' | 'cancelled'
  owner_id: string
  created_by: string | null
  related_to_type: 'company' | 'contact' | 'opportunity' | null
  related_to_id: string | null
  completed_at: string | null
  created_at: string
}

export interface TimelineRow {
  kind: 'activity' | 'task'
  id: string
  occurred_at: string
  activity_type: string
  title: string | null
  payload: Record<string, unknown>
  actor_id: string | null
}

// ============ Comunicação Omnichannel (adendo) ============
// Nomes deliberadamente distintos de `Channel`/`Campaign` acima — aquelas
// mapeiam a tabela antiga `campaign` (singular, atribuição de lead,
// migration 0028); estas mapeiam `channels`/`campaigns` (plural, disparo
// em massa, migrations 0031+). As duas coexistem no banco por decisão
// explícita (ver comentário de 0036_campaigns.sql) — não são a mesma coisa.

export type ChannelAccountType = 'whatsapp' | 'instagram'
export type ChannelAccountProvider = 'evolution_api' | 'instagram_graph_api'
export type ChannelAccountStatus = 'connected' | 'disconnected' | 'error' | 'pending_qr'

export interface ChannelAccount {
  id: string
  owner_id: string
  type: ChannelAccountType
  provider: ChannelAccountProvider
  display_name: string
  phone_number: string | null
  external_account_id: string | null
  credential_ref: string | null
  status: ChannelAccountStatus
  quality_rating: 'green' | 'yellow' | 'red' | null
  is_sandbox: boolean
  connected_at: string | null
  created_at: string
}

export type ConversationStatus = 'open' | 'pending' | 'closed'

export interface Conversation {
  id: string
  owner_id: string
  channel_id: string
  contact_id: string
  opportunity_id: string | null
  status: ConversationStatus
  assigned_to: string | null
  ai_paused: boolean
  last_message_at: string | null
  created_at: string
}

export type MessageDirection = 'inbound' | 'outbound'
export type MessageSenderType = 'contact' | 'human_agent' | 'ai_agent'
export type MessageContentType = 'text' | 'image' | 'audio' | 'video' | 'document'
export type MessageStatus = 'sent' | 'delivered' | 'read' | 'failed'

export interface Message {
  id: string
  conversation_id: string
  direction: MessageDirection
  sender_type: MessageSenderType
  sender_id: string | null
  content_type: MessageContentType
  content: string | null
  transcription: string | null
  is_internal_note: boolean
  external_message_id: string | null
  status: MessageStatus
  sent_at: string
}

export interface ContactTag {
  id: string
  owner_id: string
  name: string
  color: string | null
  created_at: string
}

export interface AiAgentConfig {
  id: string
  owner_id: string
  channel_id: string | null
  name: string
  system_prompt: string
  variables: Record<string, string>
  business_hours: Record<string, string> | null
  off_hours_message: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface AiKnowledgeDocument {
  id: string
  ai_agent_config_id: string
  source_type: 'pdf' | 'link' | 'text'
  source_url: string | null
  content_extracted: string | null
  created_at: string
}

export type CampaignTemplateStatus = 'draft' | 'pending_approval' | 'approved' | 'rejected'

export interface CampaignTemplate {
  id: string
  owner_id: string
  name: string
  channel_id: string | null
  provider_template_id: string | null
  body: string
  status: CampaignTemplateStatus
  created_at: string
}

export type DispatchCampaignStatus = 'draft' | 'scheduled' | 'sending' | 'completed' | 'paused'

export interface DispatchCampaign {
  id: string
  owner_id: string
  name: string
  channel_id: string
  template_id: string | null
  audience_filter: { tags?: string[] } | null
  scheduled_at: string | null
  status: DispatchCampaignStatus
  created_by: string | null
  created_at: string
}

export type CampaignRecipientStatus = 'pending' | 'sent' | 'delivered' | 'read' | 'replied' | 'failed' | 'opted_out'

export interface CampaignRecipient {
  id: string
  campaign_id: string
  contact_id: string
  status: CampaignRecipientStatus
  sent_at: string | null
  replied_at: string | null
}

export interface CampaignFollowupRule {
  id: string
  campaign_id: string
  wait_hours: number
  message_template_id: string | null
  stop_on_reply: boolean
}

export interface TenantSettings {
  owner_id: string
  brand_name: string | null
  brand_logo_url: string | null
  brand_primary_color: string | null
  default_business_hours: Record<string, string> | null
  cost_per_message: number | null
  updated_at: string
}

// ============ Fluxos (Workflows) — adendo adiciona triggers/ações de mensageria ============

export type WorkflowTriggerType =
  | 'opportunity_stage_change'
  | 'task_overdue'
  | 'contact_created'
  | 'message_received'
  | 'conversation_idle'
  | 'campaign_replied'

export interface Workflow {
  id: string
  owner_id: string
  name: string
  is_active: boolean
  trigger_type: WorkflowTriggerType
  created_at: string
  updated_at: string
}

export type WorkflowConditionOperator = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte'

export interface WorkflowCondition {
  id: string
  workflow_id: string
  field: string
  operator: WorkflowConditionOperator
  value: unknown
  created_at: string
}

export type WorkflowActionType =
  | 'create_task'
  | 'notify_user'
  | 'update_field'
  | 'call_webhook'
  | 'send_message'
  | 'add_tag'
  | 'move_opportunity_stage'

export interface WorkflowAction {
  id: string
  workflow_id: string
  action_type: WorkflowActionType
  config: Record<string, unknown>
  display_order: number
  created_at: string
}

export type WorkflowExecutionStatus = 'success' | 'failed' | 'skipped'

export interface WorkflowExecutionLog {
  id: string
  workflow_id: string | null
  owner_id: string
  triggered_at: string
  trigger_context: Record<string, unknown>
  status: WorkflowExecutionStatus
  action_results: { action_id: string; action_type: string; success: boolean; message: string }[] | null
  error_message: string | null
}

export interface DashboardSummary {
  forecast: {
    total_value: number
    weighted_forecast: number
    opportunity_count: number
  }
  pending_tasks: Pick<TaskItem, 'id' | 'title' | 'due_at' | 'status'>[]
  recent_activities: {
    id: string
    type: string
    payload: Record<string, unknown>
    created_at: string
    related_to_type: string
    related_to_id: string
  }[]
}
