import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthContext'
import type { Opportunity } from '../lib/types'
import { Card, CardBody, CardHeader } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { Badge } from '../components/ui/Badge'
import { Spinner, ErrorBanner, EmptyState } from '../components/ui/Feedback'
import { formatCurrency } from '../lib/format'
import { useRealtimeTable } from '../hooks/useRealtimeTable'

type ClientRow = Opportunity & { companies: { name: string } | null }

const HEALTH_ORDER = ['saudavel', 'atencao', 'risco'] as const
const healthTone = { saudavel: 'green', atencao: 'amber', risco: 'red' } as const
const healthLabel = { saudavel: 'saudável', atencao: 'atenção', risco: 'crítico' } as const

export function CustomerSuccessPage() {
  const { profile } = useAuth()
  const queryClient = useQueryClient()
  const [npsInput, setNpsInput] = useState('')
  const [editingNps, setEditingNps] = useState(false)

  const clientsKey = ['customer-success-clients']
  const { data: clients, isLoading, error } = useQuery({
    queryKey: clientsKey,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('opportunities')
        .select('*, companies(name)')
        .eq('status', 'won')
        .order('closed_at', { ascending: false })
      if (error) throw error
      return data as ClientRow[]
    },
  })

  const { data: nps } = useQuery({
    queryKey: ['nps-score'],
    queryFn: async () => {
      const { data, error } = await supabase.from('nps_score').select('*').maybeSingle()
      if (error) throw error
      return data as { score: number; survey_label: string | null } | null
    },
  })

  useRealtimeTable(queryClient, 'opportunities', [clientsKey])

  const attentionCount = useMemo(
    () => (clients ?? []).filter((c) => c.health === 'atencao' || c.health === 'risco').length,
    [clients]
  )

  const cycleHealthMutation = useMutation({
    mutationFn: async (c: ClientRow) => {
      const currentIndex = HEALTH_ORDER.indexOf((c.health ?? 'saudavel') as (typeof HEALTH_ORDER)[number])
      const next = HEALTH_ORDER[(currentIndex + 1) % HEALTH_ORDER.length]
      const { error } = await supabase.from('opportunities').update({ health: next }).eq('id', c.id)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: clientsKey }),
  })

  const saveNpsMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('nps_score').upsert({
        owner_id: profile!.id,
        score: Number(npsInput),
        survey_label: new Intl.DateTimeFormat('pt-BR', { month: 'long' }).format(new Date()),
      })
      if (error) throw error
    },
    onSuccess: () => {
      setEditingNps(false)
      queryClient.invalidateQueries({ queryKey: ['nps-score'] })
    },
  })

  return (
    <div className="animate-fade-up space-y-4">
      <div>
        <h1 className="text-[22px] font-extrabold tracking-tight text-ink">Sucesso do Cliente</h1>
        <p className="mt-0.5 text-[13px] text-ink-muted">Saúde, retenção e relacionamento com quem já fechou</p>
      </div>

      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-3">
        <Card><CardBody className="p-4">
          <p className="text-xs font-semibold text-ink-muted">Clientes ativos</p>
          <p className="mt-1.5 text-[26px] font-extrabold tracking-tight text-ink">{clients?.length ?? 0}</p>
          <p className="mt-0.5 text-xs text-ink-muted">negócios na etapa Fechado</p>
        </CardBody></Card>
        <Card><CardBody className="p-4">
          <p className="text-xs font-semibold text-ink-muted">Precisam de atenção</p>
          <p className="mt-1.5 text-[26px] font-extrabold tracking-tight text-warning">{attentionCount}</p>
          <p className="mt-0.5 text-xs text-ink-muted">clique na saúde para reclassificar</p>
        </CardBody></Card>
        <Card><CardBody className="p-4">
          <div className="flex items-baseline justify-between">
            <p className="text-xs font-semibold text-ink-muted">NPS</p>
            {!editingNps && <button onClick={() => { setNpsInput(String(nps?.score ?? '')); setEditingNps(true) }} className="text-[11px] font-bold text-accent">editar</button>}
          </div>
          {editingNps ? (
            <div className="mt-1.5 flex items-center gap-1.5">
              <Input type="number" min="0" max="100" value={npsInput} onChange={(e) => setNpsInput(e.target.value)} className="w-20" />
              <Button onClick={() => saveNpsMutation.mutate()} disabled={saveNpsMutation.isPending}>Salvar</Button>
            </div>
          ) : (
            <>
              <p className="mt-1.5 text-[26px] font-extrabold tracking-tight text-success">{nps?.score ?? '—'}</p>
              <p className="mt-0.5 text-xs text-ink-muted">{nps?.survey_label ? `última pesquisa · ${nps.survey_label}` : 'nenhuma pesquisa registrada'}</p>
            </>
          )}
        </CardBody></Card>
      </div>

      {isLoading && <Spinner />}
      {error && <ErrorBanner message={(error as Error).message} />}

      {clients && (
        <Card>
          <CardHeader>Clientes</CardHeader>
          <CardBody className="divide-y divide-border-light p-0">
            {clients.length === 0 && <EmptyState message="Nenhum cliente na etapa Fechado ainda — feche o primeiro negócio no pipeline." />}
            {clients.map((c) => (
              <div key={c.id} className="flex items-center gap-4 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-bold text-ink">{c.name}</p>
                  <p className="truncate text-xs text-ink-muted">{c.companies?.name}</p>
                </div>
                <span className="w-28 text-right text-[13px] font-extrabold text-ink">{formatCurrency(Number(c.value))}</span>
                <button onClick={() => cycleHealthMutation.mutate(c)} title="Clique para reclassificar">
                  <Badge tone={healthTone[c.health ?? 'saudavel']}>{healthLabel[c.health ?? 'saudavel']}</Badge>
                </button>
                <Link to={`/opportunities/${c.id}`} className="text-[12px] font-bold text-accent hover:text-accent-hover">Ver perfil</Link>
              </div>
            ))}
          </CardBody>
        </Card>
      )}
    </div>
  )
}
