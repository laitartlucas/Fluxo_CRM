import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthContext'
import { checkChannelStatus } from '../lib/api'
import type { ChannelAccount, ChannelAccountType } from '../lib/types'
import { Card, CardBody, CardHeader } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { Badge } from '../components/ui/Badge'
import { Spinner, ErrorBanner, EmptyState } from '../components/ui/Feedback'
import { useRealtimeTable } from '../hooks/useRealtimeTable'
import { channelStatusTone, channelStatusLabel } from '../lib/format'

export function ContasPage() {
  const { profile } = useAuth()
  const queryClient = useQueryClient()
  const [showForm, setShowForm] = useState(false)

  const channelsKey = ['channels']
  const { data: channels, isLoading, error } = useQuery({
    queryKey: channelsKey,
    queryFn: async () => {
      const { data, error } = await supabase.from('channels').select('*').order('created_at', { ascending: false })
      if (error) throw error
      return data as ChannelAccount[]
    },
  })
  useRealtimeTable(queryClient, 'channels', [channelsKey])

  const removeMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('channels').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: channelsKey }),
  })

  const [reconnectError, setReconnectError] = useState<string | null>(null)
  const [reconnectingId, setReconnectingId] = useState<string | null>(null)
  const reconnectMutation = useMutation({
    mutationFn: async (id: string) => {
      setReconnectingId(id)
      return checkChannelStatus(id)
    },
    onSuccess: () => { setReconnectError(null); queryClient.invalidateQueries({ queryKey: channelsKey }) },
    onError: (err) => setReconnectError((err as Error).message),
    onSettled: () => setReconnectingId(null),
  })

  return (
    <div className="animate-fade-up space-y-4">
      <div className="flex items-center gap-3">
        <div className="mr-auto">
          <h1 className="text-[22px] font-extrabold tracking-tight text-ink">Contas</h1>
          <p className="mt-0.5 text-[13px] text-ink-muted">Canais de mensageria conectados (WhatsApp e Instagram)</p>
        </div>
        <Button onClick={() => setShowForm((v) => !v)}>{showForm ? 'Cancelar' : 'Conectar canal'}</Button>
      </div>

      {showForm && (
        <NewChannelForm ownerId={profile!.id} onCreated={() => { setShowForm(false); queryClient.invalidateQueries({ queryKey: channelsKey }) }} />
      )}

      {isLoading && <Spinner />}
      {error && <ErrorBanner message={(error as Error).message} />}
      {reconnectError && <ErrorBanner message={reconnectError} />}

      <Card>
        <CardHeader>Canais</CardHeader>
        <CardBody className="space-y-2">
          {channels?.length === 0 && <EmptyState message="Nenhum canal conectado ainda." />}
          {channels?.map((c) => (
            <div key={c.id} className="flex items-center gap-3 rounded-[11px] border border-border px-3.5 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-bold text-ink">{c.display_name}</p>
                <p className="text-[11.5px] text-ink-muted">
                  {c.type === 'whatsapp' ? 'WhatsApp (Evolution API)' : 'Instagram (Meta Graph API)'}
                  {c.phone_number && ` · ${c.phone_number}`}
                  {c.is_sandbox && ' · sandbox'}
                </p>
              </div>
              {c.quality_rating && (
                <Badge tone={c.quality_rating === 'green' ? 'green' : c.quality_rating === 'yellow' ? 'amber' : 'red'}>
                  qualidade {c.quality_rating}
                </Badge>
              )}
              <Badge tone={channelStatusTone(c.status)}>{channelStatusLabel(c.status)}</Badge>
              {c.status !== 'connected' && (
                <Button
                  variant="secondary"
                  onClick={() => { setReconnectError(null); reconnectMutation.mutate(c.id) }}
                  disabled={reconnectingId === c.id}
                >
                  {reconnectingId === c.id ? 'Verificando…' : 'Reconectar'}
                </Button>
              )}
              <Button variant="ghost" onClick={() => removeMutation.mutate(c.id)}>✕</Button>
            </div>
          ))}
        </CardBody>
      </Card>
    </div>
  )
}

function NewChannelForm({ ownerId, onCreated }: { ownerId: string; onCreated: () => void }) {
  const [type, setType] = useState<ChannelAccountType>('whatsapp')
  const [displayName, setDisplayName] = useState('')
  const [phoneNumber, setPhoneNumber] = useState('')
  const [externalAccountId, setExternalAccountId] = useState('')
  const [credentialRef, setCredentialRef] = useState('')
  const [isSandbox, setIsSandbox] = useState(true)
  const [formError, setFormError] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('channels').insert({
        owner_id: ownerId,
        type,
        provider: type === 'whatsapp' ? 'evolution_api' : 'instagram_graph_api',
        display_name: displayName,
        phone_number: type === 'whatsapp' ? phoneNumber || null : null,
        external_account_id: type === 'instagram' ? externalAccountId || null : null,
        credential_ref: credentialRef || null,
        is_sandbox: isSandbox,
        status: 'pending_qr',
      })
      if (error) throw error
    },
    onSuccess: onCreated,
    onError: (err) => setFormError((err as Error).message),
  })

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setFormError(null)
    mutation.mutate()
  }

  return (
    <Card>
      <CardBody>
        <form onSubmit={handleSubmit} className="space-y-2.5">
          {formError && <ErrorBanner message={formError} />}
          <p className="rounded-[10px] border border-border-light bg-page px-3 py-2 text-[11.5px] text-ink-muted">
            <strong className="text-ink">credential_ref</strong> é o nome do secret configurado no projeto de Edge
            Functions — não cole o token/senha aqui. Para WhatsApp, esse secret guarda um JSON com a URL/API key da
            sua instância Evolution API; para Instagram, o Page Access Token.
          </p>
          <div className="flex gap-2">
            <select className="rounded-[10px] border border-border bg-surface-alt px-3 py-2.5 text-[13px] focus:border-accent focus:outline-none" value={type} onChange={(e) => setType(e.target.value as ChannelAccountType)}>
              <option value="whatsapp">WhatsApp</option>
              <option value="instagram">Instagram</option>
            </select>
            <Input required value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Nome de exibição" className="flex-1" />
          </div>
          {type === 'whatsapp' ? (
            <Input value={phoneNumber} onChange={(e) => setPhoneNumber(e.target.value)} placeholder="Número (com DDI, ex: 5511999999999)" />
          ) : (
            <Input value={externalAccountId} onChange={(e) => setExternalAccountId(e.target.value)} placeholder="ID da conta profissional do Instagram" />
          )}
          <Input value={credentialRef} onChange={(e) => setCredentialRef(e.target.value)} placeholder="Nome do secret (ex: EVOLUTION_CRED_minha_conta)" />
          <label className="flex items-center gap-2 text-[12.5px] font-semibold text-ink-muted">
            <input type="checkbox" checked={isSandbox} onChange={(e) => setIsSandbox(e.target.checked)} />
            Modo sandbox (número de teste, recomendado antes de conectar o número de produção)
          </label>
          <Button type="submit" disabled={mutation.isPending}>{mutation.isPending ? 'Salvando…' : 'Salvar canal'}</Button>
        </form>
      </CardBody>
    </Card>
  )
}
