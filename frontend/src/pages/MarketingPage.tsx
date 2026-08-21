import { useMemo, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthContext'
import type { Campaign, Channel } from '../lib/types'
import { Card, CardBody, CardHeader } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { Badge } from '../components/ui/Badge'
import { Spinner, ErrorBanner, EmptyState } from '../components/ui/Feedback'
import { channelLabel } from '../lib/format'
import { useRealtimeTable } from '../hooks/useRealtimeTable'

const CHANNELS: Channel[] = ['instagram', 'indicacao', 'anuncios', 'site', 'whatsapp', 'outro']

export function MarketingPage() {
  const { profile } = useAuth()
  const queryClient = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [name, setName] = useState('')
  const [channel, setChannel] = useState<Channel>('instagram')
  const [goal, setGoal] = useState('')
  const [formError, setFormError] = useState<string | null>(null)

  const campaignsKey = ['campaigns']
  const { data: campaigns, isLoading, error } = useQuery({
    queryKey: campaignsKey,
    queryFn: async () => {
      const { data, error } = await supabase.from('campaign').select('*').order('created_at', { ascending: false })
      if (error) throw error
      return data as Campaign[]
    },
  })

  const contactsKey = ['contacts-marketing']
  const { data: contacts } = useQuery({
    queryKey: contactsKey,
    queryFn: async () => {
      const { data, error } = await supabase.from('contacts').select('id, source, campaign_id')
      if (error) throw error
      return data as { id: string; source: string | null; campaign_id: string | null }[]
    },
  })

  useRealtimeTable(queryClient, 'campaign', [campaignsKey])
  useRealtimeTable(queryClient, 'contacts', [contactsKey])

  const leadsByCampaign = useMemo(() => {
    const map = new Map<string, number>()
    for (const c of contacts ?? []) {
      if (c.campaign_id) map.set(c.campaign_id, (map.get(c.campaign_id) ?? 0) + 1)
    }
    return map
  }, [contacts])

  const bySource = useMemo(() => {
    const map = new Map<string, number>()
    for (const c of contacts ?? []) {
      const key = c.source ?? 'outro'
      map.set(key, (map.get(key) ?? 0) + 1)
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1])
  }, [contacts])

  const topSource = bySource[0]?.[0]
  const maxSourceCount = bySource[0]?.[1] ?? 1

  const createMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('campaign').insert({ owner_id: profile!.id, name, channel, goal: goal || null })
      if (error) throw error
    },
    onSuccess: () => {
      setName(''); setGoal(''); setChannel('instagram'); setShowForm(false)
      queryClient.invalidateQueries({ queryKey: campaignsKey })
    },
    onError: (err) => setFormError((err as Error).message),
  })

  const toggleMutation = useMutation({
    mutationFn: async (c: Campaign) => {
      const { error } = await supabase.from('campaign').update({ status: c.status === 'active' ? 'paused' : 'active' }).eq('id', c.id)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: campaignsKey }),
  })

  const removeMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('campaign').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: campaignsKey }),
  })

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setFormError(null)
    createMutation.mutate()
  }

  return (
    <div className="animate-fade-up space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="mr-auto">
          <h1 className="text-[22px] font-extrabold tracking-tight text-ink">Marketing</h1>
          <p className="mt-0.5 text-[13px] text-ink-muted">Campanhas, canais e geração de leads</p>
        </div>
        <Button onClick={() => setShowForm((v) => !v)}>{showForm ? 'Cancelar' : 'Nova campanha'}</Button>
      </div>

      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-3">
        <Card><CardBody className="p-4">
          <p className="text-xs font-semibold text-ink-muted">Leads no funil</p>
          <p className="mt-1.5 text-[26px] font-extrabold tracking-tight text-ink">{contacts?.length ?? 0}</p>
        </CardBody></Card>
        <Card><CardBody className="p-4">
          <p className="text-xs font-semibold text-ink-muted">Campanhas ativas</p>
          <p className="mt-1.5 text-[26px] font-extrabold tracking-tight text-ink">{campaigns?.filter((c) => c.status === 'active').length ?? 0}</p>
        </CardBody></Card>
        <Card><CardBody className="p-4">
          <p className="text-xs font-semibold text-ink-muted">Melhor canal</p>
          <p className="mt-1.5 text-[26px] font-extrabold tracking-tight text-ink">{topSource ? channelLabel(topSource) : '—'}</p>
        </CardBody></Card>
      </div>

      {showForm && (
        <Card>
          <CardBody>
            <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3">
              <div className="min-w-[200px] flex-1">
                <label className="mb-1 block text-xs font-medium text-ink-muted">Nome</label>
                <Input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Divulgação Instagram" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-ink-muted">Canal</label>
                <select className="w-full rounded-[10px] border border-border bg-surface-alt px-3 py-2.5 text-[13px] focus:border-accent focus:outline-none"
                  value={channel} onChange={(e) => setChannel(e.target.value as Channel)}>
                  {CHANNELS.map((c) => <option key={c} value={c}>{channelLabel(c)}</option>)}
                </select>
              </div>
              <div className="min-w-[200px] flex-1">
                <label className="mb-1 block text-xs font-medium text-ink-muted">Objetivo (opcional)</label>
                <Input value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="Gerar leads qualificados" />
              </div>
              <Button type="submit" disabled={createMutation.isPending}>{createMutation.isPending ? 'Salvando…' : 'Salvar'}</Button>
            </form>
            {formError && <div className="mt-2"><ErrorBanner message={formError} /></div>}
          </CardBody>
        </Card>
      )}

      {isLoading && <Spinner />}
      {error && <ErrorBanner message={(error as Error).message} />}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>Campanhas</CardHeader>
          <CardBody className="space-y-2">
            {campaigns?.length === 0 && <EmptyState message="Nenhuma campanha criada ainda." />}
            {campaigns?.map((c) => (
              <div key={c.id} className="flex items-center gap-2.5 rounded-[11px] border border-border px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-bold text-ink">{c.name}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <Badge tone="slate">{channelLabel(c.channel)}</Badge>
                    {c.goal && <span className="text-[11.5px] text-ink-muted">{c.goal}</span>}
                    <span className="text-[11.5px] text-ink-muted">· {leadsByCampaign.get(c.id) ?? 0} leads gerados</span>
                  </div>
                </div>
                <button onClick={() => toggleMutation.mutate(c)} title="Clique para ativar/pausar">
                  <Badge tone={c.status === 'active' ? 'green' : 'slate'}>{c.status === 'active' ? 'ativa' : 'pausada'}</Badge>
                </button>
                <Button variant="ghost" onClick={() => removeMutation.mutate(c.id)} title="Remover campanha">✕</Button>
              </div>
            ))}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>Leads por origem</CardHeader>
          <CardBody className="space-y-3">
            {bySource.length === 0 && <EmptyState message="Nenhum lead com origem registrada ainda." />}
            {bySource.map(([source, count]) => (
              <div key={source} className="grid grid-cols-[86px_1fr_24px] items-center gap-3">
                <span className="truncate text-[12.5px] font-semibold text-ink-muted">{channelLabel(source)}</span>
                <div className="h-[22px] overflow-hidden rounded-[7px] bg-page">
                  <div className="h-full rounded-[7px] bg-accent" style={{ width: `${(count / maxSourceCount) * 100}%` }} />
                </div>
                <span className="text-right text-[13px] font-extrabold text-ink">{count}</span>
              </div>
            ))}
          </CardBody>
        </Card>
      </div>
    </div>
  )
}
