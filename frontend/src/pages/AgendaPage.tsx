import { useMemo, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthContext'
import type { Appointment } from '../lib/types'
import { Card, CardBody } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { ErrorBanner } from '../components/ui/Feedback'
import { useRealtimeTable } from '../hooks/useRealtimeTable'

const WEEKDAY_LABELS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex']

function startOfWeek(offset: number): Date {
  const now = new Date()
  const day = now.getDay() // 0=Sun..6=Sat
  const diffToMonday = day === 0 ? -6 : 1 - day
  const monday = new Date(now)
  monday.setHours(0, 0, 0, 0)
  monday.setDate(now.getDate() + diffToMonday + offset * 7)
  return monday
}

function isSameDay(a: Date, b: Date): boolean {
  return a.toDateString() === b.toDateString()
}

export function AgendaPage() {
  const { profile } = useAuth()
  const queryClient = useQueryClient()
  const [weekOffset, setWeekOffset] = useState(0)
  const [showForm, setShowForm] = useState(false)
  const [title, setTitle] = useState('')
  const [startAt, setStartAt] = useState('')
  const [description, setDescription] = useState('')
  const [formError, setFormError] = useState<string | null>(null)

  const monday = useMemo(() => startOfWeek(weekOffset), [weekOffset])
  const days = useMemo(
    () => Array.from({ length: 5 }, (_, i) => {
      const d = new Date(monday)
      d.setDate(monday.getDate() + i)
      return d
    }),
    [monday]
  )
  const rangeEnd = useMemo(() => {
    const d = new Date(monday)
    d.setDate(monday.getDate() + 5)
    return d
  }, [monday])

  const queryKey = ['appointments', monday.toISOString()]
  const { data: appointments, isLoading, error } = useQuery({
    queryKey,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('appointment')
        .select('*')
        .gte('start_at', monday.toISOString())
        .lt('start_at', rangeEnd.toISOString())
        .order('start_at')
      if (error) throw error
      return data as Appointment[]
    },
  })

  useRealtimeTable(queryClient, 'appointment', [queryKey])

  const createMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('appointment').insert({
        title,
        description: description || null,
        start_at: new Date(startAt).toISOString(),
        owner_id: profile!.id,
      })
      if (error) throw error
    },
    onSuccess: () => {
      setTitle('')
      setStartAt('')
      setDescription('')
      setShowForm(false)
      queryClient.invalidateQueries({ queryKey })
    },
    onError: (err) => setFormError((err as Error).message),
  })

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setFormError(null)
    createMutation.mutate()
  }

  const today = new Date()

  return (
    <div className="animate-fade-up space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="mr-auto">
          <h1 className="text-[22px] font-extrabold tracking-tight text-ink">Agenda</h1>
          <p className="mt-0.5 text-[13px] text-ink-muted">
            {monday.toLocaleDateString('pt-BR', { day: 'numeric', month: 'long' })} · semana de trabalho
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <Button variant="secondary" onClick={() => setWeekOffset((o) => o - 1)}>←</Button>
          <Button variant="secondary" onClick={() => setWeekOffset(0)}>Hoje</Button>
          <Button variant="secondary" onClick={() => setWeekOffset((o) => o + 1)}>→</Button>
        </div>
        <Button onClick={() => setShowForm((v) => !v)}>{showForm ? 'Cancelar' : 'Novo compromisso'}</Button>
      </div>

      {showForm && (
        <Card>
          <CardBody>
            <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3">
              <div className="min-w-[220px] flex-1">
                <label className="mb-1 block text-xs font-medium text-ink-muted">Título</label>
                <Input required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ligação · Marina Costa" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-ink-muted">Data e hora</label>
                <Input type="datetime-local" required value={startAt} onChange={(e) => setStartAt(e.target.value)} />
              </div>
              <div className="min-w-[200px] flex-1">
                <label className="mb-1 block text-xs font-medium text-ink-muted">Descrição (opcional)</label>
                <Input value={description} onChange={(e) => setDescription(e.target.value)} />
              </div>
              <Button type="submit" disabled={createMutation.isPending}>
                {createMutation.isPending ? 'Salvando…' : 'Salvar'}
              </Button>
            </form>
            {formError && <div className="mt-2"><ErrorBanner message={formError} /></div>}
          </CardBody>
        </Card>
      )}

      {isLoading && <p className="text-sm text-ink-muted">Carregando…</p>}
      {error && <ErrorBanner message={(error as Error).message} />}

      {appointments && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-5">
          {days.map((day, i) => {
            const dayEvents = appointments.filter((a) => isSameDay(new Date(a.start_at), day))
            const isToday = isSameDay(day, today)
            return (
              <div key={i}>
                <div className="flex items-baseline gap-1.5 px-1 pb-2.5">
                  <span className={`text-lg font-extrabold ${isToday ? 'text-accent' : 'text-ink'}`}>{day.getDate()}</span>
                  <span className="text-xs font-semibold text-ink-muted">{WEEKDAY_LABELS[i]}</span>
                  {isToday && <span className="ml-auto rounded-full bg-accent-light px-1.5 py-0.5 text-[10px] font-extrabold text-accent">HOJE</span>}
                </div>
                <div className="flex flex-col gap-1.5">
                  {dayEvents.map((ev) => (
                    <Card key={ev.id} className="p-2.5">
                      <div className="mb-0.5 flex items-center gap-1.5">
                        <span className="h-1.5 w-1.5 rounded-full bg-accent" />
                        <span className="text-[11px] font-extrabold text-ink-muted">
                          {new Date(ev.start_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                      <p className="text-[12.5px] font-bold leading-tight text-ink">{ev.title}</p>
                      {ev.description && <p className="mt-0.5 text-[11.5px] text-ink-muted">{ev.description}</p>}
                    </Card>
                  ))}
                  {dayEvents.length === 0 && (
                    <div className="rounded-[10px] border-[1.5px] border-dashed border-border-light py-4 text-center text-[11.5px] text-ink-faint">
                      Livre
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      <Card>
        <CardBody className="flex items-center gap-3">
          <div className="grid h-[34px] w-[34px] flex-none place-items-center rounded-[10px] bg-accent-light">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="text-accent">
              <path d="M18 9a6 6 0 0 0-12 0c0 6-2 7-2 7h16s-2-1-2-7M10.5 20a2 2 0 0 0 3 0" />
            </svg>
          </div>
          <div className="flex-1">
            <p className="text-[13px] font-extrabold text-ink">Lembretes automáticos ativados</p>
            <p className="mt-0.5 text-xs text-ink-muted">
              Você recebe um aviso antes de cada compromisso (padrão: 30 minutos) e um resumo das tarefas pendentes todo dia às 8h.
            </p>
          </div>
        </CardBody>
      </Card>
    </div>
  )
}
