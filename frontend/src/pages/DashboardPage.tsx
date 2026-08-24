import { useQuery } from '@tanstack/react-query'
import { getDashboardSummary } from '../lib/api'
import { useAuth } from '../auth/AuthContext'
import { supabase } from '../lib/supabase'
import { Card, CardBody, CardHeader } from '../components/ui/Card'
import { Spinner, ErrorBanner, EmptyState } from '../components/ui/Feedback'
import { Badge } from '../components/ui/Badge'
import { RankedBarChart } from '../components/ui/RankedBarChart'
import {
  formatCurrency, formatDateTime, relatedLabel, formatMinutes, formatPercentDelta,
  channelStatusTone, channelStatusLabel,
} from '../lib/format'
import type { ChannelAccount, TenantSettings } from '../lib/types'

const DAY_MS = 24 * 60 * 60 * 1000

interface MessagePeriodStats {
  sent: number
  delivered: number
  read: number
  aiSent: number
  humanSent: number
}

function emptyPeriodStats(): MessagePeriodStats {
  return { sent: 0, delivered: 0, read: 0, aiSent: 0, humanSent: 0 }
}

interface MessagingDashboardData {
  current: MessagePeriodStats
  previous: MessagePeriodStats
  responseTimeAiMinutes: number | null
  responseTimeHumanMinutes: number | null
  channelVolume: { label: string; value: number }[]
  outboundMessageCount: number
  distinctConversationsWithOutbound: number
}

interface MessageStatsRow {
  conversation_id: string
  direction: 'inbound' | 'outbound'
  sender_type: 'contact' | 'human_agent' | 'ai_agent'
  status: string
  is_internal_note: boolean
  sent_at: string
  conversations: { channel_id: string; channels: { display_name: string } | null } | null
}

// Tudo calculado no frontend a partir de messages/campaign_recipients (RLS
// já escopa por tenant) — mesma decisão já registrada aqui antes: não vale
// a pena mexer no contrato de get-dashboard-summary só para isso. Uma
// única query de 60 dias alimenta período atual + anterior (comparativo),
// volume por canal e tempo de resposta — evita 4 round-trips separados.
function useMessagingDashboard() {
  return useQuery({
    queryKey: ['dashboard-messaging-stats'],
    queryFn: async (): Promise<MessagingDashboardData> => {
      const since = new Date(Date.now() - 60 * DAY_MS).toISOString()
      const { data, error } = await supabase
        .from('messages')
        .select('conversation_id, direction, sender_type, status, is_internal_note, sent_at, conversations!inner(channel_id, channels(display_name))')
        .gte('sent_at', since)
      if (error) throw error
      const rows = (data ?? []) as unknown as MessageStatsRow[]

      const now = Date.now()
      const currentStart = now - 30 * DAY_MS
      const previousStart = now - 60 * DAY_MS

      const current = emptyPeriodStats()
      const previous = emptyPeriodStats()
      const channelVolumeMap = new Map<string, number>()
      const byConversation = new Map<string, MessageStatsRow[]>()
      const outboundConvSet = new Set<string>()
      let outboundMessageCount = 0

      for (const row of rows) {
        const t = new Date(row.sent_at).getTime()
        const bucket = t >= currentStart ? current : t >= previousStart ? previous : null
        if (bucket && row.direction === 'outbound') {
          bucket.sent++
          if (row.status === 'delivered' || row.status === 'read') bucket.delivered++
          if (row.status === 'read') bucket.read++
          if (row.sender_type === 'ai_agent') bucket.aiSent++
          if (row.sender_type === 'human_agent') bucket.humanSent++
        }
        if (t >= currentStart) {
          if (row.direction === 'outbound') {
            outboundMessageCount++
            outboundConvSet.add(row.conversation_id)
            const channelName = row.conversations?.channels?.display_name
            if (channelName) channelVolumeMap.set(channelName, (channelVolumeMap.get(channelName) ?? 0) + 1)
          }
          const list = byConversation.get(row.conversation_id) ?? []
          list.push(row)
          byConversation.set(row.conversation_id, list)
        }
      }

      // Tempo de primeira resposta: para cada conversa, pareia a mensagem
      // inbound do contato com a PRÓXIMA saída (IA ou humano) — só a
      // primeira resposta depois de cada inbound conta, para não inflar a
      // média com follow-ups do próprio atendente na sequência.
      const aiDeltas: number[] = []
      const humanDeltas: number[] = []
      for (const msgs of byConversation.values()) {
        const sorted = [...msgs].sort((a, b) => new Date(a.sent_at).getTime() - new Date(b.sent_at).getTime())
        let pendingInboundAt: number | null = null
        for (const m of sorted) {
          if (m.direction === 'inbound' && m.sender_type === 'contact' && !m.is_internal_note) {
            pendingInboundAt = new Date(m.sent_at).getTime()
          } else if (m.direction === 'outbound' && pendingInboundAt !== null && (m.sender_type === 'ai_agent' || m.sender_type === 'human_agent')) {
            const deltaMinutes = (new Date(m.sent_at).getTime() - pendingInboundAt) / 60_000
            if (deltaMinutes >= 0) {
              (m.sender_type === 'ai_agent' ? aiDeltas : humanDeltas).push(deltaMinutes)
            }
            pendingInboundAt = null
          }
        }
      }
      const avg = (values: number[]) => (values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length)

      return {
        current,
        previous,
        responseTimeAiMinutes: avg(aiDeltas),
        responseTimeHumanMinutes: avg(humanDeltas),
        channelVolume: [...channelVolumeMap.entries()].map(([label, value]) => ({ label, value })),
        outboundMessageCount,
        distinctConversationsWithOutbound: outboundConvSet.size,
      }
    },
  })
}

function useCampaignVolume() {
  return useQuery({
    queryKey: ['dashboard-campaign-volume'],
    queryFn: async () => {
      const { data, error } = await supabase.from('campaigns').select('name, campaign_recipients(status)')
      if (error) throw error
      const rows = (data ?? []) as unknown as { name: string; campaign_recipients: { status: string }[] }[]
      return rows.map((c) => ({
        label: c.name,
        value: c.campaign_recipients.filter((r) => ['sent', 'delivered', 'read', 'replied'].includes(r.status)).length,
      }))
    },
  })
}

function useWhatsappChannelHealth() {
  return useQuery({
    queryKey: ['dashboard-whatsapp-health'],
    queryFn: async () => {
      const { data, error } = await supabase.from('channels').select('*').eq('type', 'whatsapp').order('display_name')
      if (error) throw error
      return data as ChannelAccount[]
    },
  })
}

function useTenantCostSettings(ownerId: string | undefined) {
  return useQuery({
    queryKey: ['tenant-settings', ownerId],
    enabled: !!ownerId,
    queryFn: async () => {
      const { data, error } = await supabase.from('tenant_settings').select('*').eq('owner_id', ownerId!).maybeSingle()
      if (error) throw error
      return data as TenantSettings | null
    },
  })
}

export function DashboardPage() {
  const { profile } = useAuth()
  const { data, isLoading, error } = useQuery({
    queryKey: ['dashboard-summary'],
    queryFn: getDashboardSummary,
  })
  const { data: messaging } = useMessagingDashboard()
  const { data: campaignVolume } = useCampaignVolume()
  const { data: whatsappChannels } = useWhatsappChannelHealth()
  const { data: tenantSettings } = useTenantCostSettings(profile?.id)

  const firstName = (profile?.full_name ?? profile?.email ?? '').split(' ')[0]
  const today = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date())

  if (isLoading) return <Spinner label="Carregando dashboard…" />
  if (error) return <ErrorBanner message={(error as Error).message} />
  if (!data) return null

  const costPerConversation =
    tenantSettings?.cost_per_message != null && messaging && messaging.distinctConversationsWithOutbound > 0
      ? (tenantSettings.cost_per_message * messaging.outboundMessageCount) / messaging.distinctConversationsWithOutbound
      : null

  return (
    <div className="max-w-[1060px] animate-fade-up space-y-5">
      <div>
        <h1 className="text-[23px] font-extrabold tracking-tight text-ink">Bom dia, {firstName}</h1>
        <div className="mt-0.5 text-[13px] text-ink-muted">{capitalize(today)} · aqui está o seu dia</div>
      </div>

      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-3">
        <div className="rounded-2xl bg-accent p-[22px] text-white">
          <p className="text-xs font-bold opacity-75">Forecast ponderado</p>
          <p className="my-2 text-[34px] font-extrabold tracking-tight">{formatCurrency(data.forecast.weighted_forecast)}</p>
          <p className="text-xs opacity-75">valor ponderado pela probabilidade do estágio</p>
        </div>
        <div className="rounded-2xl bg-ink p-[22px] text-white">
          <p className="text-xs font-bold opacity-65">Oportunidades abertas</p>
          <p className="my-2 text-[34px] font-extrabold tracking-tight">{data.forecast.opportunity_count}</p>
          <p className="text-xs opacity-65">negócios em andamento no funil</p>
        </div>
        <Card>
          <CardBody className="p-[22px]">
            <p className="text-xs font-bold text-ink-muted">Valor total em aberto</p>
            <p className="my-2 text-[34px] font-extrabold tracking-tight text-ink">{formatCurrency(data.forecast.total_value)}</p>
            <p className="text-xs text-ink-muted">soma de todas as oportunidades abertas</p>
          </CardBody>
        </Card>
      </div>

      {messaging && (
        <Card>
          <CardHeader>Mensageria (últimos 30 dias, comparado aos 30 dias anteriores)</CardHeader>
          <CardBody className="grid grid-cols-2 gap-4 sm:grid-cols-5">
            <MessagingStat label="Enviadas" current={messaging.current.sent} previous={messaging.previous.sent} />
            <MessagingStat label="Entregues" current={messaging.current.delivered} previous={messaging.previous.delivered} />
            <MessagingStat label="Lidas" current={messaging.current.read} previous={messaging.previous.read} />
            <MessagingStat label="Pela IA" current={messaging.current.aiSent} previous={messaging.previous.aiSent} />
            <MessagingStat label="Por humano" current={messaging.current.humanSent} previous={messaging.previous.humanSent} />
          </CardBody>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>Tempo médio até a primeira resposta</CardHeader>
          <CardBody className="grid grid-cols-2 gap-4">
            <ResponseTimeStat label="IA" dotClassName="bg-accent" minutes={messaging?.responseTimeAiMinutes ?? null} />
            <ResponseTimeStat label="Humano" dotClassName="bg-success" minutes={messaging?.responseTimeHumanMinutes ?? null} />
          </CardBody>
        </Card>

        <Card>
          <CardHeader>Custo estimado por conversa</CardHeader>
          <CardBody>
            {costPerConversation != null ? (
              <>
                <p className="text-[28px] font-extrabold tracking-tight text-ink">{formatCurrency(costPerConversation)}</p>
                <p className="mt-1 text-[11.5px] text-ink-muted">
                  {messaging?.outboundMessageCount} mensagens enviadas em {messaging?.distinctConversationsWithOutbound} conversa(s), últimos 30 dias
                </p>
              </>
            ) : (
              <p className="text-[12.5px] text-ink-muted">
                Configure o custo por mensagem em Ajustes para ver esta métrica.
              </p>
            )}
          </CardBody>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>Volume de mensagens por canal (30 dias)</CardHeader>
          <CardBody>
            <RankedBarChart
              items={messaging?.channelVolume ?? []}
              emptyMessage="Nenhuma mensagem enviada nos últimos 30 dias."
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader>Volume de envios por campanha</CardHeader>
          <CardBody>
            <RankedBarChart
              items={campaignVolume ?? []}
              emptyMessage="Nenhuma campanha com envios ainda."
            />
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader>Saúde dos números de WhatsApp</CardHeader>
        <CardBody className="space-y-2">
          {whatsappChannels?.length === 0 && <EmptyState message="Nenhum número de WhatsApp conectado ainda." />}
          {whatsappChannels?.map((c) => (
            <div key={c.id} className="flex items-center gap-2.5 rounded-[10px] border border-border px-3 py-2">
              <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-ink">{c.display_name}</span>
              {c.phone_number && <span className="text-[11px] text-ink-faint">{c.phone_number}</span>}
              {c.quality_rating && (
                <Badge tone={c.quality_rating === 'green' ? 'green' : c.quality_rating === 'yellow' ? 'amber' : 'red'}>
                  qualidade {c.quality_rating}
                </Badge>
              )}
              <Badge tone={channelStatusTone(c.status)}>{channelStatusLabel(c.status)}</Badge>
            </div>
          ))}
        </CardBody>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>Tarefas pendentes</CardHeader>
          <CardBody className="divide-y divide-border-light p-0">
            {data.pending_tasks.length === 0 && <EmptyState message="Nenhuma tarefa pendente." />}
            {data.pending_tasks.map((task) => (
              <div key={task.id} className="flex items-center justify-between px-4 py-3">
                <span className="text-sm text-ink">{task.title}</span>
                <div className="flex items-center gap-2">
                  {task.due_at && (
                    <span className="text-xs text-ink-faint">{formatDateTime(task.due_at)}</span>
                  )}
                  <Badge tone={task.status === 'in_progress' ? 'amber' : 'slate'}>{task.status}</Badge>
                </div>
              </div>
            ))}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>Atividades recentes</CardHeader>
          <CardBody className="divide-y divide-border-light p-0">
            {data.recent_activities.length === 0 && <EmptyState message="Nenhuma atividade recente." />}
            {data.recent_activities.map((activity) => (
              <div key={activity.id} className="px-4 py-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-ink">{relatedLabel(activity.type)}</span>
                  <span className="text-xs text-ink-faint">{formatDateTime(activity.created_at)}</span>
                </div>
                <p className="mt-0.5 text-xs text-ink-muted">{activity.related_to_type} · {activity.related_to_id.slice(0, 8)}</p>
              </div>
            ))}
          </CardBody>
        </Card>
      </div>
    </div>
  )
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function MessagingStat({ label, current, previous }: { label: string; current: number; previous: number }) {
  const delta = formatPercentDelta(current, previous)
  const deltaColor = delta.direction === 'up' ? 'text-success-ink' : delta.direction === 'down' ? 'text-danger' : 'text-ink-faint'
  return (
    <div>
      <p className="text-xs font-semibold text-ink-muted">{label}</p>
      <p className="mt-1 text-[20px] font-extrabold tracking-tight text-ink">{current}</p>
      <p className={`text-[10.5px] font-bold ${deltaColor}`}>{delta.label} vs. período anterior</p>
    </div>
  )
}

function ResponseTimeStat({ label, dotClassName, minutes }: { label: string; dotClassName: string; minutes: number | null }) {
  return (
    <div>
      <p className="flex items-center gap-1.5 text-xs font-semibold text-ink-muted">
        <span className={`h-2 w-2 rounded-full ${dotClassName}`} />
        {label}
      </p>
      <p className="mt-1 text-[20px] font-extrabold tracking-tight text-ink">
        {minutes != null ? formatMinutes(minutes) : '—'}
      </p>
    </div>
  )
}
