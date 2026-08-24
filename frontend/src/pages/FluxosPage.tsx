import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthContext'
import type {
  Workflow, WorkflowCondition, WorkflowAction, WorkflowExecutionLog,
  WorkflowTriggerType, WorkflowConditionOperator, WorkflowActionType,
} from '../lib/types'
import { Card, CardBody, CardHeader } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { Badge } from '../components/ui/Badge'
import { Spinner, ErrorBanner, EmptyState } from '../components/ui/Feedback'
import { Tabs } from '../components/ui/Tabs'
import { formatDateTime, workflowTriggerLabel, workflowActionLabel, workflowOperatorLabel } from '../lib/format'
import { useRealtimeTable } from '../hooks/useRealtimeTable'

const TRIGGER_TYPES: WorkflowTriggerType[] = [
  'opportunity_stage_change', 'task_overdue', 'contact_created',
  'message_received', 'conversation_idle', 'campaign_replied',
]
const ACTION_TYPES: WorkflowActionType[] = [
  'create_task', 'notify_user', 'update_field', 'call_webhook',
  'send_message', 'add_tag', 'move_opportunity_stage',
]
const OPERATORS: WorkflowConditionOperator[] = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte']

// Formatos de config por action_type — ver comentário de 0017_workflows_tables.sql
// e 0039_workflow_engine_messaging.sql (execute_workflow_action).
const ACTION_CONFIG_PLACEHOLDER: Record<WorkflowActionType, string> = {
  create_task: '{\n  "title_template": "Follow-up: {{opportunity_name}}",\n  "owner": "record_owner",\n  "due_in_hours": 24\n}',
  notify_user: '{\n  "target": "manager_of_owner",\n  "channel": "in_app",\n  "message_template": "{{opportunity_name}} mudou de estágio"\n}',
  update_field: '{\n  "table": "opportunities",\n  "field": "owner_id",\n  "value": "<uuid>"\n}',
  call_webhook: '{\n  "url": "https://example.com/hook"\n}',
  send_message: '{\n  "message_template": "Olá! Já te retorno por aqui."\n}',
  add_tag: '{\n  "tag_name": "quente"\n}',
  move_opportunity_stage: '{\n  "to_stage_name": "Em conversa"\n}',
}

export function FluxosPage() {
  const { profile } = useAuth()
  const queryClient = useQueryClient()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showNewForm, setShowNewForm] = useState(false)

  const workflowsKey = ['workflows']
  const { data: workflows, isLoading, error } = useQuery({
    queryKey: workflowsKey,
    queryFn: async () => {
      const { data, error } = await supabase.from('workflow').select('*').order('created_at', { ascending: false })
      if (error) throw error
      return data as Workflow[]
    },
  })
  useRealtimeTable(queryClient, 'workflow', [workflowsKey])

  const selected = workflows?.find((w) => w.id === selectedId) ?? workflows?.[0] ?? null

  const createMutation = useMutation({
    mutationFn: async (params: { name: string; triggerType: WorkflowTriggerType }) => {
      const { data, error } = await supabase
        .from('workflow')
        .insert({ owner_id: profile!.id, name: params.name, trigger_type: params.triggerType })
        .select('id')
        .single()
      if (error) throw error
      return data.id as string
    },
    onSuccess: (id) => {
      queryClient.invalidateQueries({ queryKey: workflowsKey })
      setSelectedId(id)
      setShowNewForm(false)
    },
  })

  return (
    <div className="animate-fade-up space-y-4">
      <div className="flex items-center gap-3">
        <div className="mr-auto">
          <h1 className="text-[22px] font-extrabold tracking-tight text-ink">Fluxos</h1>
          <p className="mt-0.5 text-[13px] text-ink-muted">Automações disparadas por eventos do pipeline e das conversas</p>
        </div>
        <Button onClick={() => setShowNewForm((v) => !v)}>{showNewForm ? 'Cancelar' : 'Novo fluxo'}</Button>
      </div>

      {showNewForm && (
        <NewWorkflowForm
          onCreate={(name, triggerType) => createMutation.mutate({ name, triggerType })}
          pending={createMutation.isPending}
          error={createMutation.error as Error | null}
        />
      )}

      {isLoading && <Spinner />}
      {error && <ErrorBanner message={(error as Error).message} />}

      {workflows && workflows.length > 0 && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[260px_1fr]">
          <Card>
            <CardBody className="space-y-1.5">
              {workflows.map((w) => (
                <button
                  key={w.id}
                  onClick={() => setSelectedId(w.id)}
                  className={clsx(
                    'w-full rounded-[10px] px-3 py-2 text-left text-[13px] font-semibold',
                    (selected?.id === w.id) ? 'bg-accent-light text-accent' : 'text-ink-muted hover:bg-page'
                  )}
                >
                  {w.name}
                  <div className="mt-0.5 text-[10.5px] font-normal text-ink-faint">
                    {workflowTriggerLabel(w.trigger_type)}
                    {!w.is_active && ' · inativo'}
                  </div>
                </button>
              ))}
            </CardBody>
          </Card>

          {selected && (
            <WorkflowEditor
              key={selected.id}
              workflow={selected}
              onChanged={() => queryClient.invalidateQueries({ queryKey: workflowsKey })}
              onDeleted={() => { setSelectedId(null); queryClient.invalidateQueries({ queryKey: workflowsKey }) }}
            />
          )}
        </div>
      )}

      {workflows?.length === 0 && !showNewForm && (
        <Card><CardBody><EmptyState message="Nenhum fluxo criado ainda." /></CardBody></Card>
      )}
    </div>
  )
}

function NewWorkflowForm({
  onCreate, pending, error,
}: { onCreate: (name: string, triggerType: WorkflowTriggerType) => void; pending: boolean; error: Error | null }) {
  const [name, setName] = useState('')
  const [triggerType, setTriggerType] = useState<WorkflowTriggerType>('opportunity_stage_change')

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    onCreate(name, triggerType)
  }

  return (
    <Card>
      <CardBody>
        <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3">
          {error && <ErrorBanner message={error.message} />}
          <div className="min-w-[220px] flex-1">
            <label className="mb-1 block text-xs font-medium text-ink-muted">Nome</label>
            <Input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: Avisar gestor quando negócio parar" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-muted">Gatilho</label>
            <select
              className="w-full rounded-[10px] border border-border bg-surface-alt px-3 py-2.5 text-[13px] focus:border-accent focus:outline-none"
              value={triggerType}
              onChange={(e) => setTriggerType(e.target.value as WorkflowTriggerType)}
            >
              {TRIGGER_TYPES.map((t) => <option key={t} value={t}>{workflowTriggerLabel(t)}</option>)}
            </select>
          </div>
          <Button type="submit" disabled={pending}>{pending ? 'Criando…' : 'Criar'}</Button>
        </form>
      </CardBody>
    </Card>
  )
}

function WorkflowEditor({
  workflow, onChanged, onDeleted,
}: { workflow: Workflow; onChanged: () => void; onDeleted: () => void }) {
  const [tab, setTab] = useState<'regras' | 'historico'>('regras')

  return (
    <div className="space-y-4">
      <Tabs tabs={[{ value: 'regras', label: 'Regras' }, { value: 'historico', label: 'Histórico' }]} active={tab} onChange={setTab} />
      {tab === 'regras' ? (
        <>
          <WorkflowSettings workflow={workflow} onSaved={onChanged} onDeleted={onDeleted} />
          <WorkflowConditions workflowId={workflow.id} />
          <WorkflowActions workflowId={workflow.id} />
        </>
      ) : (
        <WorkflowExecutionLogView workflowId={workflow.id} />
      )}
    </div>
  )
}

function WorkflowSettings({
  workflow, onSaved, onDeleted,
}: { workflow: Workflow; onSaved: () => void; onDeleted: () => void }) {
  const [name, setName] = useState(workflow.name)
  const [triggerType, setTriggerType] = useState<WorkflowTriggerType>(workflow.trigger_type)
  const [isActive, setIsActive] = useState(workflow.is_active)
  const [saveError, setSaveError] = useState<string | null>(null)

  const saveMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('workflow')
        .update({ name, trigger_type: triggerType, is_active: isActive })
        .eq('id', workflow.id)
      if (error) throw error
    },
    onSuccess: onSaved,
    onError: (err) => setSaveError((err as Error).message),
  })

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('workflow').delete().eq('id', workflow.id)
      if (error) throw error
    },
    onSuccess: onDeleted,
    onError: (err) => setSaveError((err as Error).message),
  })

  return (
    <Card>
      <CardHeader>Configuração</CardHeader>
      <CardBody className="space-y-3">
        {saveError && <ErrorBanner message={saveError} />}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-muted">Nome</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-muted">Gatilho</label>
            <select
              className="w-full rounded-[10px] border border-border bg-surface-alt px-3 py-2.5 text-[13px] focus:border-accent focus:outline-none"
              value={triggerType}
              onChange={(e) => setTriggerType(e.target.value as WorkflowTriggerType)}
            >
              {TRIGGER_TYPES.map((t) => <option key={t} value={t}>{workflowTriggerLabel(t)}</option>)}
            </select>
          </div>
        </div>
        <label className="flex items-center gap-2 text-[12.5px] font-semibold text-ink-muted">
          <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
          Ativo
        </label>
        <div className="flex items-center gap-2">
          <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
            {saveMutation.isPending ? 'Salvando…' : 'Salvar'}
          </Button>
          <Button
            variant="danger"
            onClick={() => { if (confirm(`Excluir o fluxo "${workflow.name}"? Isso remove condições, ações e o histórico junto.`)) deleteMutation.mutate() }}
            disabled={deleteMutation.isPending}
          >
            Excluir fluxo
          </Button>
        </div>
      </CardBody>
    </Card>
  )
}

function WorkflowConditions({ workflowId }: { workflowId: string }) {
  const queryClient = useQueryClient()
  const [field, setField] = useState('')
  const [operator, setOperator] = useState<WorkflowConditionOperator>('eq')
  const [value, setValue] = useState('')
  const [formError, setFormError] = useState<string | null>(null)

  const conditionsKey = ['workflow-conditions', workflowId]
  const { data: conditions } = useQuery({
    queryKey: conditionsKey,
    queryFn: async () => {
      const { data, error } = await supabase.from('workflow_condition').select('*').eq('workflow_id', workflowId).order('created_at')
      if (error) throw error
      return data as WorkflowCondition[]
    },
  })

  const addMutation = useMutation({
    mutationFn: async () => {
      let parsedValue: unknown
      try {
        parsedValue = JSON.parse(value)
      } catch {
        parsedValue = value // texto simples que não é JSON válido vira string jsonb
      }
      const { error } = await supabase.from('workflow_condition').insert({ workflow_id: workflowId, field, operator, value: parsedValue })
      if (error) throw error
    },
    onSuccess: () => { setField(''); setValue(''); queryClient.invalidateQueries({ queryKey: conditionsKey }) },
    onError: (err) => setFormError((err as Error).message),
  })

  const removeMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('workflow_condition').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: conditionsKey }),
  })

  return (
    <Card>
      <CardHeader>Condições (todas precisam ser verdadeiras — sem nenhuma, o fluxo sempre dispara)</CardHeader>
      <CardBody className="space-y-2.5">
        {formError && <ErrorBanner message={formError} />}
        {conditions?.length === 0 && <EmptyState message="Nenhuma condição — o fluxo dispara sempre que o gatilho ocorrer." />}
        {conditions?.map((c) => (
          <div key={c.id} className="flex items-center gap-2 text-[12.5px]">
            <Badge tone="slate">{c.field} {workflowOperatorLabel(c.operator)} {JSON.stringify(c.value)}</Badge>
            <Button variant="ghost" onClick={() => removeMutation.mutate(c.id)}>✕</Button>
          </div>
        ))}
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label className="mb-1 block text-[10.5px] font-medium text-ink-muted">Campo do contexto</label>
            <input
              value={field}
              onChange={(e) => setField(e.target.value)}
              placeholder="ex: days_overdue"
              className="w-40 rounded-[10px] border border-border bg-surface-alt px-2 py-1.5 text-[12.5px]"
            />
          </div>
          <div>
            <label className="mb-1 block text-[10.5px] font-medium text-ink-muted">Operador</label>
            <select
              value={operator}
              onChange={(e) => setOperator(e.target.value as WorkflowConditionOperator)}
              className="rounded-[10px] border border-border bg-surface-alt px-2 py-1.5 text-[12.5px]"
            >
              {OPERATORS.map((op) => <option key={op} value={op}>{workflowOperatorLabel(op)}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-[10.5px] font-medium text-ink-muted">Valor (JSON ou texto)</label>
            <input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder='ex: 3 ou Em conversa'
              className="w-40 rounded-[10px] border border-border bg-surface-alt px-2 py-1.5 text-[12.5px]"
            />
          </div>
          <Button variant="secondary" onClick={() => { setFormError(null); addMutation.mutate() }} disabled={!field || !value || addMutation.isPending}>
            Adicionar
          </Button>
        </div>
      </CardBody>
    </Card>
  )
}

function WorkflowActions({ workflowId }: { workflowId: string }) {
  const queryClient = useQueryClient()
  const [actionType, setActionType] = useState<WorkflowActionType>('create_task')
  const [configText, setConfigText] = useState(ACTION_CONFIG_PLACEHOLDER.create_task)
  const [formError, setFormError] = useState<string | null>(null)

  const actionsKey = ['workflow-actions', workflowId]
  const { data: actions } = useQuery({
    queryKey: actionsKey,
    queryFn: async () => {
      const { data, error } = await supabase.from('workflow_action').select('*').eq('workflow_id', workflowId).order('display_order')
      if (error) throw error
      return data as WorkflowAction[]
    },
  })

  const addMutation = useMutation({
    mutationFn: async () => {
      let config: Record<string, unknown>
      try {
        config = JSON.parse(configText)
      } catch {
        throw new Error('Configuração da ação precisa ser JSON válido')
      }
      const nextOrder = (actions?.length ?? 0) + 1
      const { error } = await supabase.from('workflow_action').insert({ workflow_id: workflowId, action_type: actionType, config, display_order: nextOrder })
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: actionsKey }),
    onError: (err) => setFormError((err as Error).message),
  })

  const removeMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('workflow_action').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: actionsKey }),
  })

  function handleActionTypeChange(next: WorkflowActionType) {
    setActionType(next)
    setConfigText(ACTION_CONFIG_PLACEHOLDER[next])
  }

  return (
    <Card>
      <CardHeader>Ações (executadas em ordem — uma falha não impede as seguintes)</CardHeader>
      <CardBody className="space-y-2.5">
        {formError && <ErrorBanner message={formError} />}
        {actions?.length === 0 && <EmptyState message="Nenhuma ação — adicione ao menos uma para o fluxo fazer algo." />}
        {actions?.map((a, idx) => (
          <div key={a.id} className="rounded-[10px] border border-border px-3 py-2">
            <div className="flex items-center gap-2">
              <Badge tone="indigo">{idx + 1}. {workflowActionLabel(a.action_type)}</Badge>
              <Button variant="ghost" className="ml-auto" onClick={() => removeMutation.mutate(a.id)}>✕</Button>
            </div>
            <pre className="mt-1.5 overflow-x-auto text-[11px] text-ink-faint">{JSON.stringify(a.config, null, 2)}</pre>
          </div>
        ))}

        <div className="space-y-2 rounded-[10px] border border-border-light p-3">
          <select
            className="w-full rounded-[10px] border border-border bg-surface-alt px-3 py-2 text-[13px] focus:border-accent focus:outline-none"
            value={actionType}
            onChange={(e) => handleActionTypeChange(e.target.value as WorkflowActionType)}
          >
            {ACTION_TYPES.map((t) => <option key={t} value={t}>{workflowActionLabel(t)}</option>)}
          </select>
          <textarea
            value={configText}
            onChange={(e) => setConfigText(e.target.value)}
            rows={5}
            className="w-full rounded-[10px] border border-border bg-surface-alt px-3 py-2 font-mono text-[12px] outline-none focus:border-accent focus:bg-surface"
          />
          <Button variant="secondary" onClick={() => { setFormError(null); addMutation.mutate() }} disabled={addMutation.isPending}>
            Adicionar ação
          </Button>
        </div>
      </CardBody>
    </Card>
  )
}

function WorkflowExecutionLogView({ workflowId }: { workflowId: string }) {
  const { data: logs, isLoading, error } = useQuery({
    queryKey: ['workflow-execution-log', workflowId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('workflow_execution_log')
        .select('*')
        .eq('workflow_id', workflowId)
        .order('triggered_at', { ascending: false })
        .limit(50)
      if (error) throw error
      return data as WorkflowExecutionLog[]
    },
  })

  return (
    <Card>
      <CardHeader>Histórico de execuções</CardHeader>
      <CardBody className="space-y-2">
        {isLoading && <Spinner />}
        {error && <ErrorBanner message={(error as Error).message} />}
        {logs?.length === 0 && <EmptyState message="Este fluxo ainda não disparou." />}
        {logs?.map((log) => (
          <div key={log.id} className="rounded-[10px] border border-border px-3 py-2 text-[12.5px]">
            <div className="flex items-center gap-2">
              <Badge tone={log.status === 'success' ? 'green' : log.status === 'failed' ? 'red' : 'slate'}>
                {log.status === 'success' ? 'sucesso' : log.status === 'failed' ? 'falhou' : 'ignorado (condições)'}
              </Badge>
              <span className="text-ink-faint">{formatDateTime(log.triggered_at)}</span>
            </div>
            {log.action_results && log.action_results.length > 0 && (
              <ul className="mt-1.5 space-y-0.5 text-[11.5px] text-ink-muted">
                {log.action_results.map((r, i) => (
                  <li key={i}>{r.success ? '✓' : '✗'} {workflowActionLabel(r.action_type)} — {r.message}</li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </CardBody>
    </Card>
  )
}
