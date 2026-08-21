import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthContext'
import type { TaskItem } from '../lib/types'
import { Card, CardBody } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { Badge } from '../components/ui/Badge'
import { Spinner, ErrorBanner, EmptyState } from '../components/ui/Feedback'
import { formatDateTime } from '../lib/format'
import { useRealtimeTable } from '../hooks/useRealtimeTable'

const statusTone: Record<TaskItem['status'], 'slate' | 'amber' | 'green' | 'red'> = {
  pending: 'slate',
  in_progress: 'amber',
  done: 'green',
  cancelled: 'red',
}

export function TasksPage() {
  const { profile } = useAuth()
  const queryClient = useQueryClient()
  const [title, setTitle] = useState('')
  const [dueAt, setDueAt] = useState('')
  const [formError, setFormError] = useState<string | null>(null)

  const queryKey = ['tasks']
  const { data, isLoading, error } = useQuery({
    queryKey,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tasks')
        .select('*')
        .order('due_at', { ascending: true, nullsFirst: false })
      if (error) throw error
      return data as TaskItem[]
    },
  })

  useRealtimeTable(queryClient, 'tasks', [queryKey])

  const createMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('tasks').insert({
        title,
        due_at: dueAt || null,
        owner_id: profile!.id,
        created_by: profile!.id,
      })
      if (error) throw error
    },
    onSuccess: () => {
      setTitle('')
      setDueAt('')
      queryClient.invalidateQueries({ queryKey })
    },
    onError: (err) => setFormError((err as Error).message),
  })

  const toggleDoneMutation = useMutation({
    mutationFn: async ({ taskId, done }: { taskId: string; done: boolean }) => {
      const { error } = await supabase.from('tasks').update({ status: done ? 'done' : 'pending' }).eq('id', taskId)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  })

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setFormError(null)
    createMutation.mutate()
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardBody>
          <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[240px]">
              <label className="mb-1 block text-xs font-medium text-ink-muted">Nova tarefa</label>
              <Input required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ligar para o cliente…" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-ink-muted">Prazo</label>
              <Input type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
            </div>
            <Button type="submit" disabled={createMutation.isPending}>
              {createMutation.isPending ? 'Salvando…' : 'Adicionar'}
            </Button>
          </form>
          {formError && <div className="mt-2"><ErrorBanner message={formError} /></div>}
        </CardBody>
      </Card>

      {isLoading && <Spinner />}
      {error && <ErrorBanner message={(error as Error).message} />}

      {data && (
        <Card>
          <CardBody className="divide-y divide-border-light p-0">
            {data.length === 0 && <EmptyState message="Nenhuma tarefa visível para você." />}
            {data.map((task) => (
              <div key={task.id} className="flex items-center gap-3 px-4 py-3">
                <input
                  type="checkbox"
                  checked={task.status === 'done'}
                  onChange={(e) => toggleDoneMutation.mutate({ taskId: task.id, done: e.target.checked })}
                  className="h-4 w-4"
                />
                <div className="flex-1">
                  <p className={`text-sm ${task.status === 'done' ? 'text-ink-faint line-through' : 'text-ink'}`}>
                    {task.title}
                  </p>
                  {task.due_at && <p className="text-xs text-ink-faint">{formatDateTime(task.due_at)}</p>}
                </div>
                <Badge tone={statusTone[task.status]}>{task.status}</Badge>
              </div>
            ))}
          </CardBody>
        </Card>
      )}
    </div>
  )
}
