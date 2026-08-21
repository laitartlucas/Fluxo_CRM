import { useQuery } from '@tanstack/react-query'
import { getDashboardSummary } from '../lib/api'
import { useAuth } from '../auth/AuthContext'
import { Card, CardBody, CardHeader } from '../components/ui/Card'
import { Spinner, ErrorBanner, EmptyState } from '../components/ui/Feedback'
import { Badge } from '../components/ui/Badge'
import { formatCurrency, formatDateTime, relatedLabel } from '../lib/format'

export function DashboardPage() {
  const { profile } = useAuth()
  const { data, isLoading, error } = useQuery({
    queryKey: ['dashboard-summary'],
    queryFn: getDashboardSummary,
  })

  const firstName = (profile?.full_name ?? profile?.email ?? '').split(' ')[0]
  const today = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date())

  if (isLoading) return <Spinner label="Carregando dashboard…" />
  if (error) return <ErrorBanner message={(error as Error).message} />
  if (!data) return null

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
