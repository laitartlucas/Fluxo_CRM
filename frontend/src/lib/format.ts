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
