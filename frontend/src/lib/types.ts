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
