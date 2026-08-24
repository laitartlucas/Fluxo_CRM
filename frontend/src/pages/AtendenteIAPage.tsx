import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthContext'
import { uploadKnowledgeDocument } from '../lib/api'
import type { AiAgentConfig, AiKnowledgeDocument, ChannelAccount } from '../lib/types'
import { Card, CardBody, CardHeader } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { Badge } from '../components/ui/Badge'
import { Spinner, ErrorBanner, EmptyState } from '../components/ui/Feedback'
import { useRealtimeTable } from '../hooks/useRealtimeTable'

type ConfigRow = AiAgentConfig & { channels: { display_name: string } | null }

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      resolve(result.split(',')[1] ?? '') // strip the data: prefix
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

export function AtendenteIAPage() {
  const { profile } = useAuth()
  const queryClient = useQueryClient()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showNewForm, setShowNewForm] = useState(false)

  const configsKey = ['ai-agent-configs']
  const { data: configs, isLoading, error } = useQuery({
    queryKey: configsKey,
    queryFn: async () => {
      const { data, error } = await supabase.from('ai_agent_configs').select('*, channels(display_name)').order('created_at')
      if (error) throw error
      return data as ConfigRow[]
    },
  })

  const { data: channels } = useQuery({
    queryKey: ['channels-for-ai-config'],
    queryFn: async () => {
      const { data, error } = await supabase.from('channels').select('id, display_name')
      if (error) throw error
      return data as Pick<ChannelAccount, 'id' | 'display_name'>[]
    },
  })

  useRealtimeTable(queryClient, 'ai_agent_configs', [configsKey])

  const selected = configs?.find((c) => c.id === selectedId) ?? configs?.[0] ?? null

  const createMutation = useMutation({
    mutationFn: async (params: { name: string; channelId: string | null }) => {
      const { error } = await supabase.from('ai_agent_configs').insert({
        owner_id: profile!.id,
        name: params.name,
        channel_id: params.channelId,
        system_prompt: 'Você é a assistente de atendimento de {nome_negocio}. Responda de forma cordial e objetiva.',
        variables: { nome_negocio: '' },
      })
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: configsKey })
      setShowNewForm(false)
    },
  })

  return (
    <div className="animate-fade-up space-y-4">
      <div className="flex items-center gap-3">
        <div className="mr-auto">
          <h1 className="text-[22px] font-extrabold tracking-tight text-ink">Atendente IA</h1>
          <p className="mt-0.5 text-[13px] text-ink-muted">Configure o agente que responde suas conversas automaticamente</p>
        </div>
        <Button onClick={() => setShowNewForm((v) => !v)}>{showNewForm ? 'Cancelar' : 'Nova configuração'}</Button>
      </div>

      {showNewForm && (
        <NewConfigForm channels={channels ?? []} onCreate={(name, channelId) => createMutation.mutate({ name, channelId })} pending={createMutation.isPending} />
      )}

      {isLoading && <Spinner />}
      {error && <ErrorBanner message={(error as Error).message} />}

      {configs && configs.length > 0 && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[240px_1fr]">
          <Card>
            <CardBody className="space-y-1.5">
              {configs.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setSelectedId(c.id)}
                  className={clsx(
                    'w-full rounded-[10px] px-3 py-2 text-left text-[13px] font-semibold',
                    (selected?.id === c.id) ? 'bg-accent-light text-accent' : 'text-ink-muted hover:bg-page'
                  )}
                >
                  {c.name}
                  <div className="mt-0.5 text-[10.5px] font-normal text-ink-faint">
                    {c.channel_id ? c.channels?.display_name ?? 'Canal' : 'Padrão do tenant'}
                    {!c.is_active && ' · inativo'}
                  </div>
                </button>
              ))}
            </CardBody>
          </Card>

          {selected && <ConfigEditor key={selected.id} config={selected} onSaved={() => queryClient.invalidateQueries({ queryKey: configsKey })} />}
        </div>
      )}

      {configs?.length === 0 && !showNewForm && (
        <Card><CardBody><EmptyState message="Nenhuma configuração de Atendente IA ainda. Crie a padrão do tenant primeiro." /></CardBody></Card>
      )}
    </div>
  )
}

function NewConfigForm({ channels, onCreate, pending }: { channels: Pick<ChannelAccount, 'id' | 'display_name'>[]; onCreate: (name: string, channelId: string | null) => void; pending: boolean }) {
  const [name, setName] = useState('')
  const [channelId, setChannelId] = useState<string>('')

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    onCreate(name, channelId || null)
  }

  return (
    <Card>
      <CardBody>
        <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3">
          <div className="min-w-[220px] flex-1">
            <label className="mb-1 block text-xs font-medium text-ink-muted">Nome</label>
            <Input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Padrão, ou nome do canal" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-muted">Canal (opcional)</label>
            <select className="w-full rounded-[10px] border border-border bg-surface-alt px-3 py-2.5 text-[13px] focus:border-accent focus:outline-none" value={channelId} onChange={(e) => setChannelId(e.target.value)}>
              <option value="">Padrão do tenant (todos os canais)</option>
              {channels.map((c) => <option key={c.id} value={c.id}>{c.display_name}</option>)}
            </select>
          </div>
          <Button type="submit" disabled={pending}>{pending ? 'Criando…' : 'Criar'}</Button>
        </form>
      </CardBody>
    </Card>
  )
}

function ConfigEditor({ config, onSaved }: { config: ConfigRow; onSaved: () => void }) {
  const [name, setName] = useState(config.name)
  const [systemPrompt, setSystemPrompt] = useState(config.system_prompt)
  const [offHoursMessage, setOffHoursMessage] = useState(config.off_hours_message ?? '')
  const [isActive, setIsActive] = useState(config.is_active)
  const [variablesText, setVariablesText] = useState(JSON.stringify(config.variables ?? {}, null, 2))
  const [businessHoursText, setBusinessHoursText] = useState(JSON.stringify(config.business_hours ?? {}, null, 2))
  const [saveError, setSaveError] = useState<string | null>(null)

  const saveMutation = useMutation({
    mutationFn: async () => {
      let variables: Record<string, string>
      let businessHours: Record<string, string> | null
      try {
        variables = JSON.parse(variablesText)
        businessHours = businessHoursText.trim() ? JSON.parse(businessHoursText) : null
      } catch {
        throw new Error('Variáveis e horário comercial precisam ser JSON válido')
      }
      const { error } = await supabase.from('ai_agent_configs').update({
        name, system_prompt: systemPrompt, off_hours_message: offHoursMessage || null,
        is_active: isActive, variables, business_hours: businessHours,
      }).eq('id', config.id)
      if (error) throw error
    },
    onSuccess: onSaved,
    onError: (err) => setSaveError((err as Error).message),
  })

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>Configuração</CardHeader>
        <CardBody className="space-y-3">
          {saveError && <ErrorBanner message={saveError} />}
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-muted">Nome</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-muted">
              Prompt do sistema — use {'{variavel}'} para referenciar as variáveis abaixo
            </label>
            <textarea
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              rows={6}
              className="w-full rounded-[10px] border border-border bg-surface-alt px-3.5 py-2.5 text-[13px] outline-none focus:border-accent focus:bg-surface"
            />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-ink-muted">Variáveis (JSON)</label>
              <textarea value={variablesText} onChange={(e) => setVariablesText(e.target.value)} rows={4} className="w-full rounded-[10px] border border-border bg-surface-alt px-3 py-2 font-mono text-[12px] outline-none focus:border-accent focus:bg-surface" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-ink-muted">Horário comercial (JSON, ex: {'{"seg-sex":"08:00-18:00"}'})</label>
              <textarea value={businessHoursText} onChange={(e) => setBusinessHoursText(e.target.value)} rows={4} className="w-full rounded-[10px] border border-border bg-surface-alt px-3 py-2 font-mono text-[12px] outline-none focus:border-accent focus:bg-surface" />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-muted">Mensagem fora do horário</label>
            <Input value={offHoursMessage} onChange={(e) => setOffHoursMessage(e.target.value)} placeholder="No momento estamos fora do horário de atendimento…" />
          </div>
          <label className="flex items-center gap-2 text-[12.5px] font-semibold text-ink-muted">
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
            Ativo
          </label>
          <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
            {saveMutation.isPending ? 'Salvando…' : 'Salvar'}
          </Button>
        </CardBody>
      </Card>

      <KnowledgeDocuments configId={config.id} />
    </div>
  )
}

function KnowledgeDocuments({ configId }: { configId: string }) {
  const queryClient = useQueryClient()
  const [linkUrl, setLinkUrl] = useState('')
  const [textContent, setTextContent] = useState('')
  const [uploadError, setUploadError] = useState<string | null>(null)

  const docsKey = ['ai-knowledge-documents', configId]
  const { data: docs } = useQuery({
    queryKey: docsKey,
    queryFn: async () => {
      const { data, error } = await supabase.from('ai_knowledge_documents').select('*').eq('ai_agent_config_id', configId).order('created_at', { ascending: false })
      if (error) throw error
      return data as AiKnowledgeDocument[]
    },
  })

  const uploadMutation = useMutation({
    mutationFn: async (params: { sourceType: 'pdf' | 'link' | 'text'; sourceUrl?: string; content?: string; fileBase64?: string }) => {
      await uploadKnowledgeDocument({ aiAgentConfigId: configId, ...params })
    },
    onSuccess: () => {
      setLinkUrl(''); setTextContent('')
      queryClient.invalidateQueries({ queryKey: docsKey })
    },
    onError: (err) => setUploadError((err as Error).message),
  })

  const removeMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('ai_knowledge_documents').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: docsKey }),
  })

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadError(null)
    const base64 = await fileToBase64(file)
    uploadMutation.mutate({ sourceType: 'pdf', fileBase64: base64 })
    e.target.value = ''
  }

  return (
    <Card>
      <CardHeader>Base de conhecimento</CardHeader>
      <CardBody className="space-y-3">
        {uploadError && <ErrorBanner message={uploadError} />}
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[220px] flex-1">
            <label className="mb-1 block text-xs font-medium text-ink-muted">Link (página com conteúdo)</label>
            <Input value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} placeholder="https://…" />
          </div>
          <Button
            variant="secondary"
            disabled={!linkUrl || uploadMutation.isPending}
            onClick={() => { setUploadError(null); uploadMutation.mutate({ sourceType: 'link', sourceUrl: linkUrl }) }}
          >
            Adicionar link
          </Button>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[220px] flex-1">
            <label className="mb-1 block text-xs font-medium text-ink-muted">Texto direto</label>
            <Input value={textContent} onChange={(e) => setTextContent(e.target.value)} placeholder="Cole um texto de referência…" />
          </div>
          <Button
            variant="secondary"
            disabled={!textContent || uploadMutation.isPending}
            onClick={() => { setUploadError(null); uploadMutation.mutate({ sourceType: 'text', content: textContent }) }}
          >
            Adicionar texto
          </Button>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-ink-muted">PDF</label>
          <input type="file" accept="application/pdf" onChange={handleFileChange} className="text-[12.5px]" />
        </div>

        <div className="space-y-2 pt-2">
          {docs?.length === 0 && <EmptyState message="Nenhum documento na base de conhecimento ainda." />}
          {docs?.map((d) => (
            <div key={d.id} className="flex items-center gap-2.5 rounded-[10px] border border-border px-3 py-2">
              <Badge tone="slate">{d.source_type}</Badge>
              <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink-muted">
                {d.source_url ?? (d.content_extracted?.slice(0, 60) ?? '')}
              </span>
              <Button variant="ghost" onClick={() => removeMutation.mutate(d.id)}>✕</Button>
            </div>
          ))}
        </div>
      </CardBody>
    </Card>
  )
}
