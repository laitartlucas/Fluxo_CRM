import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthContext'
import { sendConversationMessage } from '../lib/api'
import type { Conversation, Message } from '../lib/types'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { Badge } from '../components/ui/Badge'
import { Avatar } from '../components/ui/Avatar'
import { Spinner, ErrorBanner, EmptyState } from '../components/ui/Feedback'
import { formatDateTime } from '../lib/format'
import { useRealtimeTable } from '../hooks/useRealtimeTable'

type ConversationRow = Conversation & {
  channels: { display_name: string; type: string } | null
  contacts: { first_name: string; last_name: string | null; phone: string | null } | null
}

function contactName(c: ConversationRow['contacts']): string {
  if (!c) return 'Contato removido'
  return [c.first_name, c.last_name].filter(Boolean).join(' ')
}

export function ConversasPage() {
  const { profile } = useAuth()
  const queryClient = useQueryClient()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [isInternalNote, setIsInternalNote] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)

  const conversationsKey = ['conversations']
  const { data: conversations, isLoading, error } = useQuery({
    queryKey: conversationsKey,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('conversations')
        .select('*, channels(display_name, type), contacts(first_name, last_name, phone)')
        .order('last_message_at', { ascending: false, nullsFirst: false })
      if (error) throw error
      return data as ConversationRow[]
    },
  })

  useRealtimeTable(queryClient, 'conversations', [conversationsKey])

  useEffect(() => {
    if (!selectedId && conversations && conversations.length > 0) {
      setSelectedId(conversations[0].id)
    }
  }, [conversations, selectedId])

  const selected = conversations?.find((c) => c.id === selectedId) ?? null

  const messagesKey = ['conversation-messages', selectedId]
  const { data: messages } = useQuery({
    queryKey: messagesKey,
    enabled: !!selectedId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', selectedId!)
        .order('sent_at', { ascending: true })
      if (error) throw error
      return data as Message[]
    },
  })

  useRealtimeTable(queryClient, 'messages', [messagesKey])

  const opportunityQuery = useQuery({
    queryKey: ['conversation-opportunity', selected?.opportunity_id],
    enabled: !!selected?.opportunity_id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('opportunities')
        .select('id, name, pipeline_stages(name)')
        .eq('id', selected!.opportunity_id!)
        .maybeSingle<{ id: string; name: string; pipeline_stages: { name: string } | null }>()
      if (error) throw error
      return data
    },
  })

  const toggleAiMutation = useMutation({
    mutationFn: async () => {
      if (!selected) return
      const { error } = await supabase.from('conversations').update({ ai_paused: !selected.ai_paused }).eq('id', selected.id)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: conversationsKey }),
  })

  const sendMutation = useMutation({
    mutationFn: async () => {
      if (!selected) throw new Error('Nenhuma conversa selecionada')
      if (isInternalNote) {
        // Nota interna: nunca vira envio real (0032 força isso via CHECK
        // constraint — direction inbound é a convenção do schema para notas).
        const { error } = await supabase.from('messages').insert({
          conversation_id: selected.id,
          direction: 'inbound',
          sender_type: 'human_agent',
          sender_id: profile!.id,
          content_type: 'text',
          content: draft,
          is_internal_note: true,
        })
        if (error) throw error
      } else {
        await sendConversationMessage(selected.id, draft)
      }
    },
    onSuccess: () => {
      setDraft('')
      queryClient.invalidateQueries({ queryKey: messagesKey })
    },
    onError: (err) => setSendError((err as Error).message),
  })

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setSendError(null)
    if (!draft.trim()) return
    sendMutation.mutate()
  }

  const activeStageLabel = useMemo(() => {
    const opp = opportunityQuery.data
    return opp ? `${opp.name} · ${opp.pipeline_stages?.name ?? '—'}` : null
  }, [opportunityQuery.data])

  return (
    <div className="animate-fade-up flex h-[calc(100vh-100px)] gap-4">
      <Card className="flex w-[320px] flex-none flex-col overflow-hidden">
        <div className="border-b border-border-light px-4 py-3">
          <h1 className="text-[15px] font-extrabold text-ink">Conversas</h1>
        </div>
        <div className="flex-1 overflow-y-auto">
          {isLoading && <Spinner />}
          {error && <div className="p-3"><ErrorBanner message={(error as Error).message} /></div>}
          {conversations?.length === 0 && <div className="p-3"><EmptyState message="Nenhuma conversa ainda." /></div>}
          {conversations?.map((c) => (
            <button
              key={c.id}
              onClick={() => setSelectedId(c.id)}
              className={clsx(
                'flex w-full items-start gap-2.5 border-b border-border-light px-3.5 py-3 text-left transition-colors',
                selectedId === c.id ? 'bg-accent-light' : 'hover:bg-page'
              )}
            >
              <Avatar name={contactName(c.contacts)} size={32} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-[13px] font-bold text-ink">{contactName(c.contacts)}</span>
                  {c.last_message_at && <span className="flex-none text-[10.5px] text-ink-faint">{formatDateTime(c.last_message_at)}</span>}
                </div>
                <div className="mt-1 flex items-center gap-1.5">
                  <Badge tone="slate">{c.channels?.type === 'whatsapp' ? 'WhatsApp' : 'Instagram'}</Badge>
                  {c.ai_paused && <Badge tone="amber">IA pausada</Badge>}
                  {c.status === 'closed' && <Badge tone="slate">fechada</Badge>}
                </div>
              </div>
            </button>
          ))}
        </div>
      </Card>

      <Card className="flex flex-1 flex-col overflow-hidden">
        {!selected ? (
          <div className="flex flex-1 items-center justify-center">
            <EmptyState message="Selecione uma conversa." />
          </div>
        ) : (
          <>
            <div className="flex items-center gap-3 border-b border-border-light px-4 py-3">
              <Avatar name={contactName(selected.contacts)} size={36} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14px] font-extrabold text-ink">{contactName(selected.contacts)}</p>
                <p className="truncate text-[11.5px] text-ink-muted">
                  {selected.contacts?.phone ?? '—'} {activeStageLabel && `· Negócio: ${activeStageLabel}`}
                </p>
              </div>
              <Button variant={selected.ai_paused ? 'secondary' : 'primary'} onClick={() => toggleAiMutation.mutate()}>
                {selected.ai_paused ? 'Reativar IA' : 'Pausar IA'}
              </Button>
            </div>

            <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
              {messages?.map((m) => (
                <MessageBubble key={m.id} message={m} />
              ))}
              {messages?.length === 0 && <EmptyState message="Nenhuma mensagem ainda." />}
            </div>

            <form onSubmit={handleSubmit} className="border-t border-border-light p-3">
              {sendError && <div className="mb-2"><ErrorBanner message={sendError} /></div>}
              <div className="mb-2 flex items-center gap-2">
                <label className="flex items-center gap-1.5 text-[11.5px] font-semibold text-ink-muted">
                  <input type="checkbox" checked={isInternalNote} onChange={(e) => setIsInternalNote(e.target.checked)} />
                  Nota interna (não é enviada ao contato)
                </label>
              </div>
              <div className="flex gap-2">
                <Input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder={isInternalNote ? 'Escreva uma nota para o time…' : 'Escreva uma mensagem…'}
                />
                <Button type="submit" disabled={sendMutation.isPending}>
                  {sendMutation.isPending ? 'Enviando…' : 'Enviar'}
                </Button>
              </div>
            </form>
          </>
        )}
      </Card>
    </div>
  )
}

function MessageBubble({ message }: { message: Message }) {
  const isOutbound = message.direction === 'outbound'
  const isNote = message.is_internal_note
  const label = message.sender_type === 'ai_agent' ? 'IA' : message.sender_type === 'human_agent' ? 'Você' : null

  return (
    <div className={clsx('flex', isOutbound || isNote ? 'justify-end' : 'justify-start')}>
      <div
        className={clsx(
          'max-w-[70%] rounded-[12px] px-3.5 py-2.5 text-[13px]',
          isNote
            ? 'border border-warning/30 bg-warning/10 text-ink'
            : isOutbound
              ? 'bg-accent text-white'
              : 'border border-border bg-page text-ink'
        )}
      >
        {(label || isNote) && (
          <p className={clsx('mb-0.5 text-[10.5px] font-bold', isOutbound ? 'text-white/80' : 'text-ink-muted')}>
            {isNote ? 'Nota interna' : label}
          </p>
        )}
        <p className="whitespace-pre-wrap">{message.content_type === 'audio' ? (message.transcription ?? '[áudio]') : message.content}</p>
        <p className={clsx('mt-1 text-[10px]', isOutbound ? 'text-white/70' : 'text-ink-faint')}>{formatDateTime(message.sent_at)}</p>
      </div>
    </div>
  )
}
