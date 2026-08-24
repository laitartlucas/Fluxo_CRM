import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import type { TimelineRow } from '../lib/types'
import { Spinner, ErrorBanner, EmptyState } from './ui/Feedback'
import { formatDateTime, relatedLabel } from '../lib/format'
import { useRealtimeTable } from '../hooks/useRealtimeTable'

interface TimelineProps {
  relatedToType: 'company' | 'contact' | 'opportunity' | 'task' | 'conversation'
  relatedToId: string
}

export function Timeline({ relatedToType, relatedToId }: TimelineProps) {
  const queryClient = useQueryClient()
  const queryKey = ['timeline', relatedToType, relatedToId]

  const { data, isLoading, error } = useQuery({
    queryKey,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_timeline', {
        p_related_to_type: relatedToType,
        p_related_to_id: relatedToId,
      })
      if (error) throw error
      return data as TimelineRow[]
    },
  })

  useRealtimeTable(queryClient, 'activities', [queryKey])
  useRealtimeTable(queryClient, 'tasks', [queryKey])

  if (isLoading) return <Spinner label="Carregando histórico…" />
  if (error) return <ErrorBanner message={(error as Error).message} />
  if (!data || data.length === 0) return <EmptyState message="Nenhuma atividade registrada ainda." />

  return (
    <ol className="space-y-3">
      {data.map((row) => (
        <li key={`${row.kind}-${row.id}`} className="flex gap-3 text-sm">
          <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-accent" />
          <div className="flex-1">
            <div className="flex items-center justify-between">
              <span className="font-medium text-ink">
                {row.kind === 'task' ? row.title : relatedLabel(row.activity_type)}
              </span>
              <span className="text-xs text-ink-faint">{formatDateTime(row.occurred_at)}</span>
            </div>
            <TimelineDetail row={row} />
          </div>
        </li>
      ))}
    </ol>
  )
}

function TimelineDetail({ row }: { row: TimelineRow }) {
  if (row.kind === 'task') {
    return <p className="text-xs text-ink-muted">status: {row.activity_type}</p>
  }
  if (row.activity_type === 'stage_change') {
    const p = row.payload as { from_stage_name?: string; to_stage_name?: string }
    return (
      <p className="text-xs text-ink-muted">
        {p.from_stage_name ? `${p.from_stage_name} → ${p.to_stage_name}` : `Criado em: ${p.to_stage_name}`}
      </p>
    )
  }
  if (row.activity_type === 'field_update') {
    const p = row.payload as { field?: string; old_value?: unknown; new_value?: unknown }
    return (
      <p className="text-xs text-ink-muted">
        {p.field}: {String(p.old_value ?? '—')} → {String(p.new_value ?? '—')}
      </p>
    )
  }
  if (row.activity_type === 'opportunity_reopened') {
    const p = row.payload as { reason?: string }
    return <p className="text-xs text-ink-muted">Motivo: {p.reason}</p>
  }
  if (row.activity_type === 'message_received' || row.activity_type === 'message_sent_ai' || row.activity_type === 'message_sent_human') {
    const p = row.payload as { content_type?: string; preview?: string }
    return <p className="text-xs text-ink-muted">{p.content_type === 'audio' ? '[áudio]' : p.preview}</p>
  }
  if (row.activity_type === 'conversation_assigned') {
    return <p className="text-xs text-ink-muted">Conversa reatribuída</p>
  }
  if (row.activity_type === 'ai_prompt_audit') {
    const p = row.payload as { model?: string; response_text?: string; handoff?: boolean }
    return (
      <p className="text-xs text-ink-muted">
        [{p.model}] {p.response_text}
        {p.handoff && ' · transferida para atendimento humano'}
      </p>
    )
  }
  return null
}
