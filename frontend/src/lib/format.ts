export function formatCurrency(value: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value)
}

export function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
}

export function formatDate(value: string): string {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' }).format(new Date(value))
}

const activityLabels: Record<string, string> = {
  stage_change: 'Mudança de estágio',
  field_update: 'Campo atualizado',
  task_completed: 'Tarefa concluída',
  opportunity_reopened: 'Oportunidade reaberta',
  note: 'Nota',
  message_received: 'Mensagem recebida',
  message_sent_ai: 'Resposta da IA',
  message_sent_human: 'Mensagem enviada',
  conversation_assigned: 'Conversa atribuída',
  ai_prompt_audit: 'Auditoria de IA',
}

export function relatedLabel(type: string): string {
  return activityLabels[type] ?? type
}

const paymentMethodLabels: Record<string, string> = {
  pix: 'Pix',
  cartao: 'Cartão',
  boleto: 'Boleto',
  dinheiro: 'Dinheiro',
  transferencia: 'Transferência',
  outro: 'Outro',
}

export function paymentMethodLabel(method: string): string {
  return paymentMethodLabels[method] ?? method
}

const channelLabels: Record<string, string> = {
  instagram: 'Instagram',
  indicacao: 'Indicação',
  anuncios: 'Anúncios',
  site: 'Site',
  whatsapp: 'WhatsApp',
  outro: 'Outro',
}

export function channelLabel(channel: string): string {
  return channelLabels[channel] ?? channel
}

const workflowTriggerLabels: Record<string, string> = {
  opportunity_stage_change: 'Mudança de estágio',
  task_overdue: 'Tarefa atrasada',
  contact_created: 'Novo contato',
  message_received: 'Mensagem recebida',
  conversation_idle: 'Conversa parada',
  campaign_replied: 'Resposta de campanha',
}

export function workflowTriggerLabel(trigger: string): string {
  return workflowTriggerLabels[trigger] ?? trigger
}

const workflowActionLabels: Record<string, string> = {
  create_task: 'Criar tarefa',
  notify_user: 'Notificar usuário',
  update_field: 'Atualizar campo',
  call_webhook: 'Chamar webhook',
  send_message: 'Enviar mensagem',
  add_tag: 'Adicionar tag',
  move_opportunity_stage: 'Mover estágio da oportunidade',
}

export function workflowActionLabel(action: string): string {
  return workflowActionLabels[action] ?? action
}

const workflowOperatorLabels: Record<string, string> = {
  eq: '=', neq: '≠', gt: '>', gte: '≥', lt: '<', lte: '≤',
}

export function workflowOperatorLabel(operator: string): string {
  return workflowOperatorLabels[operator] ?? operator
}

const channelStatusTones: Record<string, 'green' | 'red' | 'amber' | 'slate'> = {
  connected: 'green', error: 'red', pending_qr: 'amber', disconnected: 'slate',
}

export function channelStatusTone(status: string): 'green' | 'red' | 'amber' | 'slate' {
  return channelStatusTones[status] ?? 'slate'
}

const channelStatusLabels: Record<string, string> = {
  connected: 'Conectado', error: 'Erro', pending_qr: 'Aguardando QR code', disconnected: 'Desconectado',
}

export function channelStatusLabel(status: string): string {
  return channelStatusLabels[status] ?? status
}

export function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${Math.round(minutes)} min`
  const hours = Math.floor(minutes / 60)
  const rest = Math.round(minutes % 60)
  return rest === 0 ? `${hours}h` : `${hours}h${rest}min`
}

export function formatPercentDelta(current: number, previous: number): { label: string; direction: 'up' | 'down' | 'flat' } {
  if (previous === 0) {
    if (current === 0) return { label: '0%', direction: 'flat' }
    return { label: '+100%', direction: 'up' }
  }
  const pct = ((current - previous) / previous) * 100
  if (Math.abs(pct) < 1) return { label: '0%', direction: 'flat' }
  return { label: `${pct > 0 ? '+' : ''}${Math.round(pct)}%`, direction: pct > 0 ? 'up' : 'down' }
}
