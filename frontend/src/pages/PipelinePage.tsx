import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { DndContext, useDraggable, useDroppable, type DragEndEvent, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { moveOpportunityStage, ApiError } from '../lib/api'
import type { Opportunity, Pipeline, PipelineStage } from '../lib/types'
import { Spinner, ErrorBanner } from '../components/ui/Feedback'
import { Card } from '../components/ui/Card'
import { PresenceBar } from '../components/PresenceBar'
import { formatCurrency } from '../lib/format'
import { useRealtimeTable } from '../hooks/useRealtimeTable'

export function PipelinePage() {
  const queryClient = useQueryClient()
  const [pipelineId, setPipelineId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const { data: pipelines } = useQuery({
    queryKey: ['pipelines'],
    queryFn: async () => {
      const { data, error } = await supabase.from('pipelines').select('id, name, is_active').eq('is_active', true).order('name')
      if (error) throw error
      return data as Pipeline[]
    },
  })

  const activePipelineId = pipelineId ?? pipelines?.[0]?.id ?? null

  const { data: stages, isLoading: stagesLoading } = useQuery({
    queryKey: ['pipeline-stages', activePipelineId],
    enabled: !!activePipelineId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('pipeline_stages')
        .select('id, pipeline_id, name, display_order, probability, is_won, is_lost')
        .eq('pipeline_id', activePipelineId!)
        .order('display_order')
      if (error) throw error
      return data as PipelineStage[]
    },
  })

  const oppsQueryKey = useMemo(() => ['opportunities', activePipelineId], [activePipelineId])
  const { data: opportunities, isLoading: oppsLoading } = useQuery({
    queryKey: oppsQueryKey,
    enabled: !!activePipelineId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('opportunities')
        .select('id, name, pipeline_id, stage_id, company_id, owner_id, value, currency, status')
        .eq('pipeline_id', activePipelineId!)
        .order('updated_at', { ascending: false })
      if (error) throw error
      return data as Opportunity[]
    },
  })

  useRealtimeTable(queryClient, 'opportunities', [oppsQueryKey])

  const moveMutation = useMutation({
    mutationFn: ({ opportunityId, newStageId }: { opportunityId: string; newStageId: string }) =>
      moveOpportunityStage(opportunityId, newStageId),
    onMutate: async ({ opportunityId, newStageId }) => {
      await queryClient.cancelQueries({ queryKey: oppsQueryKey })
      const previous = queryClient.getQueryData<Opportunity[]>(oppsQueryKey)
      queryClient.setQueryData<Opportunity[]>(oppsQueryKey, (old) =>
        old?.map((o) => (o.id === opportunityId ? { ...o, stage_id: newStageId } : o))
      )
      return { previous }
    },
    onError: (err, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(oppsQueryKey, context.previous)
      setActionError(err instanceof ApiError ? err.message : 'Não foi possível mover a oportunidade.')
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: oppsQueryKey })
    },
  })

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  function handleDragEnd(event: DragEndEvent) {
    const opportunityId = event.active.id as string
    const newStageId = event.over?.id as string | undefined
    if (!newStageId) return
    const current = opportunities?.find((o) => o.id === opportunityId)
    if (!current || current.stage_id === newStageId) return
    setActionError(null)
    moveMutation.mutate({ opportunityId, newStageId })
  }

  if (!pipelines) return <Spinner label="Carregando pipelines…" />
  if (pipelines.length === 0) return <ErrorBanner message="Nenhum pipeline ativo encontrado." />

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex items-center justify-between">
        <select
          className="rounded-md border border-border px-3 py-1.5 text-sm"
          value={activePipelineId ?? ''}
          onChange={(e) => setPipelineId(e.target.value)}
        >
          {pipelines.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        {activePipelineId && <PresenceBar room={`pipeline:${activePipelineId}`} />}
      </div>

      {actionError && <ErrorBanner message={actionError} />}

      {(stagesLoading || oppsLoading) && <Spinner label="Carregando oportunidades…" />}

      {stages && opportunities && (
        <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
          <div className="flex flex-1 gap-4 overflow-x-auto pb-4">
            {stages.map((stage) => (
              <StageColumn
                key={stage.id}
                stage={stage}
                opportunities={opportunities.filter((o) => o.stage_id === stage.id)}
              />
            ))}
          </div>
        </DndContext>
      )}
    </div>
  )
}

function StageColumn({ stage, opportunities }: { stage: PipelineStage; opportunities: Opportunity[] }) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id })
  const total = opportunities.reduce((sum, o) => sum + Number(o.value), 0)

  return (
    <div
      ref={setNodeRef}
      className={`flex w-72 shrink-0 flex-col rounded-lg border ${isOver ? 'border-accent bg-accent-light/50' : 'border-border bg-kanban-column'}`}
    >
      <div className="border-b border-border px-3 py-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-ink">{stage.name}</h3>
          <span className="text-xs text-ink-faint">{opportunities.length}</span>
        </div>
        <p className="text-xs text-ink-muted">{formatCurrency(total)}</p>
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto p-2">
        {opportunities.map((opp) => (
          <OpportunityCard key={opp.id} opportunity={opp} />
        ))}
      </div>
    </div>
  )
}

function OpportunityCard({ opportunity }: { opportunity: Opportunity }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: opportunity.id })
  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`, zIndex: 10 }
    : undefined

  return (
    <div ref={setNodeRef} style={style} {...listeners} {...attributes}>
      <Card className={`cursor-grab p-3 active:cursor-grabbing ${isDragging ? 'opacity-50 shadow-lg' : ''}`}>
        <Link
          to={`/opportunities/${opportunity.id}`}
          onClick={(e) => e.stopPropagation()}
          className="text-sm font-medium text-ink hover:text-accent"
        >
          {opportunity.name}
        </Link>
        <p className="mt-1 text-xs text-ink-muted">{formatCurrency(Number(opportunity.value))}</p>
      </Card>
    </div>
  )
}
