import { useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { summarizeOpportunityTimeline, ApiError } from '../lib/api'
import type { Opportunity, PipelineStage, Company } from '../lib/types'
import { Card, CardBody, CardHeader } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { Spinner, ErrorBanner } from '../components/ui/Feedback'
import { Badge } from '../components/ui/Badge'
import { Timeline } from '../components/Timeline'
import { PresenceBar } from '../components/PresenceBar'
import { formatCurrency } from '../lib/format'

export function OpportunityDetailPage() {
  const { id } = useParams<{ id: string }>()
  const queryClient = useQueryClient()
  const [reopenReason, setReopenReason] = useState('')
  const [showReopenForm, setShowReopenForm] = useState(false)
  const [reopenError, setReopenError] = useState<string | null>(null)

  const queryKey = ['opportunity', id]
  const { data: opportunity, isLoading, error } = useQuery({
    queryKey,
    queryFn: async () => {
      const { data, error } = await supabase.from('opportunities').select('*').eq('id', id!).maybeSingle()
      if (error) throw error
      return data as Opportunity | null
    },
  })

  const { data: stage } = useQuery({
    queryKey: ['stage', opportunity?.stage_id],
    enabled: !!opportunity,
    queryFn: async () => {
      const { data, error } = await supabase.from('pipeline_stages').select('*').eq('id', opportunity!.stage_id).maybeSingle()
      if (error) throw error
      return data as PipelineStage | null
    },
  })

  const { data: company } = useQuery({
    queryKey: ['opportunity-company', opportunity?.company_id],
    enabled: !!opportunity?.company_id,
    queryFn: async () => {
      const { data, error } = await supabase.from('companies').select('*').eq('id', opportunity!.company_id!).maybeSingle()
      if (error) throw error
      return data as Company | null
    },
  })

  const reopenMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('reopen_opportunity', {
        p_opportunity_id: id!,
        p_reason: reopenReason,
      })
      if (error) throw error
    },
    onSuccess: () => {
      setShowReopenForm(false)
      setReopenReason('')
      queryClient.invalidateQueries({ queryKey })
      queryClient.invalidateQueries({ queryKey: ['timeline', 'opportunity', id] })
    },
    onError: (err) => setReopenError((err as Error).message),
  })

  const [summaryError, setSummaryError] = useState<string | null>(null)
  const summaryMutation = useMutation({
    mutationFn: () => summarizeOpportunityTimeline(id!),
    onError: (err) => setSummaryError(err instanceof ApiError ? err.message : 'Não foi possível gerar o resumo.'),
    onSuccess: () => setSummaryError(null),
  })

  if (isLoading) return <Spinner />
  if (error) return <ErrorBanner message={(error as Error).message} />
  if (!opportunity) return <ErrorBanner message="Oportunidade não encontrada (ou fora do seu escopo de acesso)." />

  const isClosed = opportunity.status !== 'open'

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-[22px] font-extrabold tracking-tight text-ink">{opportunity.name}</h1>
          <p className="text-sm text-ink-muted">
            {company && <Link to={`/companies/${company.id}`} className="text-accent hover:underline">{company.name}</Link>}
          </p>
        </div>
        <PresenceBar room={`opportunity:${opportunity.id}`} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex items-center justify-between">
            <span className="font-medium text-ink">Detalhes</span>
            <Badge tone={opportunity.status === 'won' ? 'green' : opportunity.status === 'lost' ? 'red' : 'indigo'}>
              {opportunity.status}
            </Badge>
          </CardHeader>
          <CardBody className="space-y-2 text-sm text-ink-muted">
            <p>Valor: {formatCurrency(Number(opportunity.value))}</p>
            <p>Estágio: {stage?.name ?? '—'}</p>
            {opportunity.expected_close_date && <p>Previsão de fechamento: {opportunity.expected_close_date}</p>}
            {opportunity.closed_at && <p>Fechado em: {new Date(opportunity.closed_at).toLocaleString('pt-BR')}</p>}

            {isClosed && (
              <div className="pt-2">
                {!showReopenForm ? (
                  <Button variant="secondary" onClick={() => setShowReopenForm(true)}>
                    Reabrir oportunidade
                  </Button>
                ) : (
                  <div className="space-y-2 rounded-md border border-border p-3">
                    <label className="block text-xs font-medium text-ink-muted">Motivo da reabertura</label>
                    <textarea
                      className="w-full rounded-md border border-border px-3 py-2 text-sm"
                      rows={2}
                      value={reopenReason}
                      onChange={(e) => setReopenReason(e.target.value)}
                    />
                    {reopenError && <ErrorBanner message={reopenError} />}
                    <div className="flex gap-2">
                      <Button
                        disabled={!reopenReason.trim() || reopenMutation.isPending}
                        onClick={() => {
                          setReopenError(null)
                          reopenMutation.mutate()
                        }}
                      >
                        {reopenMutation.isPending ? 'Reabrindo…' : 'Confirmar'}
                      </Button>
                      <Button variant="ghost" onClick={() => setShowReopenForm(false)}>
                        Cancelar
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </CardBody>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader className="font-medium text-ink">Resumo com IA</CardHeader>
            <CardBody className="space-y-2">
              <Button
                variant="secondary"
                onClick={() => {
                  setSummaryError(null)
                  summaryMutation.mutate()
                }}
                disabled={summaryMutation.isPending}
              >
                {summaryMutation.isPending ? 'Gerando…' : 'Gerar resumo'}
              </Button>
              {summaryError && <ErrorBanner message={summaryError} />}
              {summaryMutation.data && (
                <div className="rounded-md bg-page p-3 text-sm text-ink-muted">
                  <p>{summaryMutation.data.summary}</p>
                  <p className="mt-2 text-xs text-ink-faint">
                    {summaryMutation.data.cached ? 'Do cache' : 'Recém-gerado'} · baseado em {summaryMutation.data.activity_count} evento(s)
                  </p>
                </div>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader className="font-medium text-ink">Histórico</CardHeader>
            <CardBody>
              <Timeline relatedToType="opportunity" relatedToId={opportunity.id} />
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  )
}
