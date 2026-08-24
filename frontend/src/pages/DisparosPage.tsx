import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthContext'
import type { CampaignTemplate, ChannelAccount, ContactTag, DispatchCampaign, CampaignFollowupRule } from '../lib/types'
import { Card, CardBody, CardHeader } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { Badge } from '../components/ui/Badge'
import { Spinner, ErrorBanner, EmptyState } from '../components/ui/Feedback'
import { formatDateTime } from '../lib/format'
import { useRealtimeTable } from '../hooks/useRealtimeTable'

const CAMPAIGN_STATUS_LABEL: Record<string, string> = {
  draft: 'rascunho', scheduled: 'agendada', sending: 'enviando', completed: 'concluída', paused: 'pausada',
}

export function DisparosPage() {
  const { profile } = useAuth()
  const queryClient = useQueryClient()

  const channelsKey = ['channels-for-disparos']
  const { data: channels } = useQuery({
    queryKey: channelsKey,
    queryFn: async () => {
      const { data, error } = await supabase.from('channels').select('id, display_name, type')
      if (error) throw error
      return data as Pick<ChannelAccount, 'id' | 'display_name' | 'type'>[]
    },
  })

  const templatesKey = ['campaign-templates']
  const { data: templates } = useQuery({
    queryKey: templatesKey,
    queryFn: async () => {
      const { data, error } = await supabase.from('campaign_templates').select('*').order('created_at', { ascending: false })
      if (error) throw error
      return data as CampaignTemplate[]
    },
  })
  useRealtimeTable(queryClient, 'campaign_templates', [templatesKey])

  const tagsKey = ['tags-for-disparos']
  const { data: tags } = useQuery({
    queryKey: tagsKey,
    queryFn: async () => {
      const { data, error } = await supabase.from('tags').select('*').order('name')
      if (error) throw error
      return data as ContactTag[]
    },
  })

  const campaignsKey = ['dispatch-campaigns']
  const { data: campaigns, isLoading, error } = useQuery({
    queryKey: campaignsKey,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('campaigns')
        .select('*, channels(display_name, type), campaign_templates(name), campaign_recipients(id, status)')
        .order('created_at', { ascending: false })
      if (error) throw error
      return data as (DispatchCampaign & {
        channels: { display_name: string; type: string } | null
        campaign_templates: { name: string } | null
        campaign_recipients: { id: string; status: string }[]
      })[]
    },
  })
  useRealtimeTable(queryClient, 'campaigns', [campaignsKey])

  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null)

  return (
    <div className="animate-fade-up space-y-4">
      <div>
        <h1 className="text-[22px] font-extrabold tracking-tight text-ink">Disparos</h1>
        <p className="mt-0.5 text-[13px] text-ink-muted">Campanhas de mensagem em massa por WhatsApp e Instagram</p>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <NewTemplateForm channels={channels ?? []} ownerId={profile!.id} onCreated={() => queryClient.invalidateQueries({ queryKey: templatesKey })} />
        <NewCampaignForm
          channels={channels ?? []}
          templates={templates ?? []}
          tags={tags ?? []}
          ownerId={profile!.id}
          onCreated={() => queryClient.invalidateQueries({ queryKey: campaignsKey })}
        />
      </div>

      {isLoading && <Spinner />}
      {error && <ErrorBanner message={(error as Error).message} />}

      <Card>
        <CardHeader>Campanhas</CardHeader>
        <CardBody className="space-y-2">
          {campaigns?.length === 0 && <EmptyState message="Nenhuma campanha criada ainda." />}
          {campaigns?.map((c) => {
            const total = c.campaign_recipients.length
            const sent = c.campaign_recipients.filter((r) => ['sent', 'delivered', 'read', 'replied'].includes(r.status)).length
            const replied = c.campaign_recipients.filter((r) => r.status === 'replied').length
            return (
              <div key={c.id} className="rounded-[11px] border border-border px-3.5 py-3">
                <div className="flex flex-wrap items-center gap-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-bold text-ink">{c.name}</p>
                    <p className="text-[11.5px] text-ink-muted">
                      {c.channels?.display_name} · {c.campaign_templates?.name ?? 'sem template'} · {total} destinatário(s), {sent} enviado(s), {replied} respondido(s)
                    </p>
                  </div>
                  <Badge tone={c.status === 'completed' ? 'green' : c.status === 'sending' ? 'amber' : 'slate'}>
                    {CAMPAIGN_STATUS_LABEL[c.status] ?? c.status}
                  </Badge>
                  {c.scheduled_at && <span className="text-[11px] text-ink-faint">{formatDateTime(c.scheduled_at)}</span>}
                  <Button variant="ghost" onClick={() => setSelectedCampaignId(selectedCampaignId === c.id ? null : c.id)}>
                    Follow-ups
                  </Button>
                </div>
                {selectedCampaignId === c.id && (
                  <div className="mt-3 border-t border-border-light pt-3">
                    <FollowupRules campaignId={c.id} templates={templates?.filter((t) => t.channel_id === c.channel_id) ?? []} />
                  </div>
                )}
              </div>
            )
          })}
        </CardBody>
      </Card>
    </div>
  )
}

function NewTemplateForm({ channels, ownerId, onCreated }: { channels: Pick<ChannelAccount, 'id' | 'display_name' | 'type'>[]; ownerId: string; onCreated: () => void }) {
  const [name, setName] = useState('')
  const [channelId, setChannelId] = useState('')
  const [templateBody, setTemplateBody] = useState('')
  const [formError, setFormError] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('campaign_templates').insert({ owner_id: ownerId, name, channel_id: channelId || null, body: templateBody })
      if (error) throw error
    },
    onSuccess: () => { setName(''); setTemplateBody(''); onCreated() },
    onError: (err) => setFormError((err as Error).message),
  })

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setFormError(null)
    mutation.mutate()
  }

  return (
    <Card>
      <CardHeader>Novo template</CardHeader>
      <CardBody>
        <form onSubmit={handleSubmit} className="space-y-2.5">
          {formError && <ErrorBanner message={formError} />}
          <Input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome do template" />
          <select className="w-full rounded-[10px] border border-border bg-surface-alt px-3 py-2.5 text-[13px] focus:border-accent focus:outline-none" value={channelId} onChange={(e) => setChannelId(e.target.value)}>
            <option value="">Selecione o canal</option>
            {channels.map((c) => <option key={c.id} value={c.id}>{c.display_name}</option>)}
          </select>
          <textarea
            required
            value={templateBody}
            onChange={(e) => setTemplateBody(e.target.value)}
            rows={3}
            placeholder="Olá {{nome}}, tudo bem? …"
            className="w-full rounded-[10px] border border-border bg-surface-alt px-3.5 py-2.5 text-[13px] outline-none focus:border-accent focus:bg-surface"
          />
          <Button type="submit" disabled={mutation.isPending}>{mutation.isPending ? 'Salvando…' : 'Criar template'}</Button>
        </form>
      </CardBody>
    </Card>
  )
}

function NewCampaignForm({
  channels, templates, tags, ownerId, onCreated,
}: {
  channels: Pick<ChannelAccount, 'id' | 'display_name' | 'type'>[]
  templates: CampaignTemplate[]
  tags: ContactTag[]
  ownerId: string
  onCreated: () => void
}) {
  const [name, setName] = useState('')
  const [channelId, setChannelId] = useState('')
  const [templateId, setTemplateId] = useState('')
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [scheduledAt, setScheduledAt] = useState('')
  const [formError, setFormError] = useState<string | null>(null)

  const selectedChannel = channels.find((c) => c.id === channelId)
  const isInstagramCold = selectedChannel?.type === 'instagram'

  const mutation = useMutation({
    mutationFn: async () => {
      if (isInstagramCold) {
        throw new Error('Instagram não tem templates aprovados nem envio fora da janela de 24h — campanha fria não é possível nesse canal.')
      }
      // Resolve audiência: contatos com QUALQUER uma das tags selecionadas, sem opt-out (LGPD).
      let contactIds: string[] = []
      if (selectedTags.length > 0) {
        const { data: matches, error: matchError } = await supabase
          .from('contact_tags')
          .select('contact_id, contacts!inner(id, opted_out_at)')
          .in('tag_id', selectedTags)
        if (matchError) throw matchError
        const unique = new Map<string, boolean>()
        for (const row of (matches ?? []) as unknown as { contact_id: string; contacts: { opted_out_at: string | null } }[]) {
          if (!row.contacts.opted_out_at) unique.set(row.contact_id, true)
        }
        contactIds = [...unique.keys()]
      }
      if (contactIds.length === 0) {
        throw new Error('Nenhum contato elegível encontrado para as tags selecionadas (verifique opt-outs).')
      }

      const { data: campaign, error: campaignError } = await supabase
        .from('campaigns')
        .insert({
          owner_id: ownerId, name, channel_id: channelId, template_id: templateId || null,
          audience_filter: { tags: selectedTags }, scheduled_at: scheduledAt || null,
          status: scheduledAt ? 'scheduled' : 'draft', created_by: ownerId,
        })
        .select('id')
        .single()
      if (campaignError) throw campaignError

      const { error: recipientsError } = await supabase
        .from('campaign_recipients')
        .insert(contactIds.map((contactId) => ({ campaign_id: campaign.id, contact_id: contactId })))
      if (recipientsError) throw recipientsError
    },
    onSuccess: () => {
      setName(''); setSelectedTags([]); setScheduledAt('')
      onCreated()
    },
    onError: (err) => setFormError((err as Error).message),
  })

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setFormError(null)
    mutation.mutate()
  }

  function toggleTag(id: string) {
    setSelectedTags((prev) => (prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]))
  }

  return (
    <Card>
      <CardHeader>Nova campanha</CardHeader>
      <CardBody>
        <form onSubmit={handleSubmit} className="space-y-2.5">
          {formError && <ErrorBanner message={formError} />}
          <Input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome da campanha" />
          <select required className="w-full rounded-[10px] border border-border bg-surface-alt px-3 py-2.5 text-[13px] focus:border-accent focus:outline-none" value={channelId} onChange={(e) => setChannelId(e.target.value)}>
            <option value="">Selecione o canal</option>
            {channels.map((c) => <option key={c.id} value={c.id}>{c.display_name}</option>)}
          </select>

          {isInstagramCold && (
            <ErrorBanner message="Instagram não tem equivalente aos templates aprovados do WhatsApp — sem envio fora de uma janela de 24h já aberta pelo lead. Campanha fria nesse canal vai falhar no envio. Use Instagram só como follow-up de conversas já abertas, não aqui." />
          )}

          <select className="w-full rounded-[10px] border border-border bg-surface-alt px-3 py-2.5 text-[13px] focus:border-accent focus:outline-none" value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
            <option value="">Selecione o template</option>
            {templates.filter((t) => !channelId || t.channel_id === channelId).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>

          <div>
            <p className="mb-1 text-xs font-medium text-ink-muted">Audiência (tags)</p>
            <div className="flex flex-wrap gap-1.5">
              {tags.length === 0 && <span className="text-[11.5px] text-ink-faint">Nenhuma tag cadastrada ainda.</span>}
              {tags.map((t) => (
                <button
                  type="button"
                  key={t.id}
                  onClick={() => toggleTag(t.id)}
                  className={selectedTags.includes(t.id) ? 'opacity-100' : 'opacity-40'}
                >
                  <Badge tone="indigo">{t.name}</Badge>
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-ink-muted">Agendar para (opcional — sem data, fica como rascunho)</label>
            <input
              type="datetime-local"
              value={scheduledAt}
              onChange={(e) => setScheduledAt(e.target.value)}
              className="w-full rounded-[10px] border border-border bg-surface-alt px-3.5 py-2.5 text-[13px] outline-none focus:border-accent focus:bg-surface"
            />
          </div>

          <Button type="submit" disabled={mutation.isPending || isInstagramCold}>{mutation.isPending ? 'Criando…' : 'Criar campanha'}</Button>
        </form>
      </CardBody>
    </Card>
  )
}

function FollowupRules({ campaignId, templates }: { campaignId: string; templates: CampaignTemplate[] }) {
  const queryClient = useQueryClient()
  const [waitHours, setWaitHours] = useState('24')
  const [templateId, setTemplateId] = useState('')
  const [stopOnReply, setStopOnReply] = useState(true)

  const rulesKey = ['campaign-followup-rules', campaignId]
  const { data: rules } = useQuery({
    queryKey: rulesKey,
    queryFn: async () => {
      const { data, error } = await supabase.from('campaign_followup_rules').select('*, campaign_templates(name)').eq('campaign_id', campaignId)
      if (error) throw error
      return data as (CampaignFollowupRule & { campaign_templates: { name: string } | null })[]
    },
  })

  const addMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('campaign_followup_rules').insert({
        campaign_id: campaignId, wait_hours: Number(waitHours), message_template_id: templateId || null, stop_on_reply: stopOnReply,
      })
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: rulesKey }),
  })

  const removeMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('campaign_followup_rules').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: rulesKey }),
  })

  return (
    <div className="space-y-2">
      {rules?.map((r) => (
        <div key={r.id} className="flex items-center gap-2 text-[12.5px]">
          <Badge tone="slate">{r.wait_hours}h sem resposta</Badge>
          <span className="text-ink-muted">{r.campaign_templates?.name ?? 'sem template'}</span>
          {r.stop_on_reply && <Badge tone="green">para se responder</Badge>}
          <Button variant="ghost" onClick={() => removeMutation.mutate(r.id)}>✕</Button>
        </div>
      ))}
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <label className="mb-1 block text-[10.5px] font-medium text-ink-muted">Horas sem resposta</label>
          <input type="number" min={1} value={waitHours} onChange={(e) => setWaitHours(e.target.value)} className="w-24 rounded-[10px] border border-border bg-surface-alt px-2 py-1.5 text-[12.5px]" />
        </div>
        <select className="rounded-[10px] border border-border bg-surface-alt px-2 py-1.5 text-[12.5px]" value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
          <option value="">Template do follow-up</option>
          {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <label className="flex items-center gap-1.5 text-[11.5px] text-ink-muted">
          <input type="checkbox" checked={stopOnReply} onChange={(e) => setStopOnReply(e.target.checked)} />
          Parar se responder
        </label>
        <Button variant="secondary" onClick={() => addMutation.mutate()} disabled={!templateId || addMutation.isPending}>Adicionar</Button>
      </div>
    </div>
  )
}
