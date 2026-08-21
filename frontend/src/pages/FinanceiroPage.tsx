import { useMemo, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthContext'
import type { Charge, PaymentMethod } from '../lib/types'
import { Card, CardBody } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { Badge } from '../components/ui/Badge'
import { Spinner, ErrorBanner, EmptyState } from '../components/ui/Feedback'
import { formatCurrency, formatDate, paymentMethodLabel } from '../lib/format'
import { useRealtimeTable } from '../hooks/useRealtimeTable'

type ChargeRow = Charge & { contacts: { first_name: string; last_name: string | null } | null }

const PAYMENT_METHODS: PaymentMethod[] = ['pix', 'cartao', 'boleto', 'dinheiro', 'transferencia', 'outro']

const statusTone = { proposed: 'indigo', pending: 'amber', paid: 'green' } as const
const statusLabel = { proposed: 'em proposta', pending: 'pendente', paid: 'pago' } as const

function contactName(row: ChargeRow): string {
  if (!row.contacts) return '—'
  return [row.contacts.first_name, row.contacts.last_name].filter(Boolean).join(' ')
}

export function FinanceiroPage() {
  const { profile } = useAuth()
  const queryClient = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [showReport, setShowReport] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const [contactId, setContactId] = useState('')
  const [description, setDescription] = useState('')
  const [value, setValue] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('pix')
  const [status, setStatus] = useState<'proposed' | 'pending'>('pending')

  const [reportStart, setReportStart] = useState('')
  const [reportEnd, setReportEnd] = useState('')
  const [reportContact, setReportContact] = useState('')
  const [reportRows, setReportRows] = useState<ChargeRow[] | null>(null)
  const [reportError, setReportError] = useState<string | null>(null)

  const queryKey = ['charges']
  const { data: charges, isLoading, error } = useQuery({
    queryKey,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('charge')
        .select('*, contacts(first_name, last_name)')
        .order('due_date', { ascending: false })
      if (error) throw error
      return data as ChargeRow[]
    },
  })

  const { data: contacts } = useQuery({
    queryKey: ['contacts-for-charges'],
    queryFn: async () => {
      const { data, error } = await supabase.from('contacts').select('id, first_name, last_name').order('first_name')
      if (error) throw error
      return data as { id: string; first_name: string; last_name: string | null }[]
    },
  })

  useRealtimeTable(queryClient, 'charge', [queryKey])

  const stats = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10)
    const thisMonth = new Date().toISOString().slice(0, 7)
    const acc = { paid: 0, pendingNotDue: 0, overdue: 0, proposed: 0 }
    for (const c of charges ?? []) {
      if (c.status === 'paid' && c.paid_at?.slice(0, 7) === thisMonth) acc.paid += Number(c.value)
      else if (c.status === 'pending' && c.due_date >= today) acc.pendingNotDue += Number(c.value)
      else if (c.status === 'pending' && c.due_date < today) acc.overdue += Number(c.value)
      else if (c.status === 'proposed') acc.proposed += Number(c.value)
    }
    return acc
  }, [charges])

  const createMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('charge').insert({
        owner_id: profile!.id,
        contact_id: contactId,
        description,
        value: Number(value),
        due_date: dueDate,
        payment_method: paymentMethod,
        status,
      })
      if (error) throw error
    },
    onSuccess: () => {
      setContactId(''); setDescription(''); setValue(''); setDueDate(''); setPaymentMethod('pix'); setStatus('pending')
      setShowForm(false)
      queryClient.invalidateQueries({ queryKey })
    },
    onError: (err) => setFormError((err as Error).message),
  })

  const toggleMutation = useMutation({
    mutationFn: async (row: ChargeRow) => {
      const next = row.status === 'paid' ? 'pending' : row.status === 'pending' ? 'paid' : 'pending'
      const { error } = await supabase.from('charge').update({ status: next }).eq('id', row.id)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  })

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setFormError(null)
    createMutation.mutate()
  }

  async function handleReport(e: FormEvent) {
    e.preventDefault()
    setReportError(null)
    let query = supabase.from('charge').select('*, contacts(first_name, last_name)').order('due_date')
    if (reportStart) query = query.gte('due_date', reportStart)
    if (reportEnd) query = query.lte('due_date', reportEnd)
    if (reportContact) query = query.eq('contact_id', reportContact)
    const { data, error } = await query
    if (error) {
      setReportError(error.message)
      return
    }
    setReportRows(data as ChargeRow[])
  }

  function exportCsv() {
    if (!reportRows) return
    const header = 'Contato,Descrição,Valor,Vencimento,Forma,Status\n'
    const lines = reportRows.map((r) =>
      [contactName(r), r.description, r.value, r.due_date, paymentMethodLabel(r.payment_method), statusLabel[r.status]]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(',')
    )
    const csv = header + lines.join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `financeiro-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="animate-fade-up space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="mr-auto">
          <h1 className="text-[22px] font-extrabold tracking-tight text-ink">Financeiro</h1>
          <p className="mt-0.5 text-[13px] text-ink-muted">Visão simples de pagamentos e propostas</p>
        </div>
        <Button variant="secondary" onClick={() => setShowReport((v) => !v)}>{showReport ? 'Fechar relatório' : 'Gerar relatório'}</Button>
        <Button onClick={() => setShowForm((v) => !v)}>{showForm ? 'Cancelar' : 'Nova cobrança'}</Button>
      </div>

      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-4">
        <StatCard dot="bg-success" label="Recebido no mês" value={formatCurrency(stats.paid)} />
        <StatCard dot="bg-warning" label="A receber" value={formatCurrency(stats.pendingNotDue)} />
        <StatCard dot="bg-danger" label="Atrasado" value={formatCurrency(stats.overdue)} tone="danger" />
        <StatCard dot="bg-accent" label="Em proposta" value={formatCurrency(stats.proposed)} />
      </div>

      {showForm && (
        <Card>
          <CardBody>
            <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3">
              <div className="min-w-[180px]">
                <label className="mb-1 block text-xs font-medium text-ink-muted">Contato</label>
                <select required className="w-full rounded-[10px] border border-border bg-surface-alt px-3 py-2.5 text-[13px] focus:border-accent focus:outline-none"
                  value={contactId} onChange={(e) => setContactId(e.target.value)}>
                  <option value="" disabled>Selecione…</option>
                  {contacts?.map((c) => (
                    <option key={c.id} value={c.id}>{[c.first_name, c.last_name].filter(Boolean).join(' ')}</option>
                  ))}
                </select>
              </div>
              <div className="min-w-[200px] flex-1">
                <label className="mb-1 block text-xs font-medium text-ink-muted">Descrição</label>
                <Input required value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Mentoria de agosto" />
              </div>
              <div className="w-32">
                <label className="mb-1 block text-xs font-medium text-ink-muted">Valor</label>
                <Input required type="number" min="0" step="0.01" value={value} onChange={(e) => setValue(e.target.value)} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-ink-muted">Vencimento</label>
                <Input required type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-ink-muted">Forma</label>
                <select className="w-full rounded-[10px] border border-border bg-surface-alt px-3 py-2.5 text-[13px] focus:border-accent focus:outline-none"
                  value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}>
                  {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{paymentMethodLabel(m)}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-ink-muted">Status inicial</label>
                <select className="w-full rounded-[10px] border border-border bg-surface-alt px-3 py-2.5 text-[13px] focus:border-accent focus:outline-none"
                  value={status} onChange={(e) => setStatus(e.target.value as 'proposed' | 'pending')}>
                  <option value="pending">Pendente</option>
                  <option value="proposed">Em proposta</option>
                </select>
              </div>
              <Button type="submit" disabled={createMutation.isPending}>{createMutation.isPending ? 'Salvando…' : 'Salvar'}</Button>
            </form>
            {formError && <div className="mt-2"><ErrorBanner message={formError} /></div>}
          </CardBody>
        </Card>
      )}

      {showReport && (
        <Card>
          <CardBody>
            <form onSubmit={handleReport} className="flex flex-wrap items-end gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-ink-muted">De</label>
                <Input type="date" value={reportStart} onChange={(e) => setReportStart(e.target.value)} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-ink-muted">Até</label>
                <Input type="date" value={reportEnd} onChange={(e) => setReportEnd(e.target.value)} />
              </div>
              <div className="min-w-[180px]">
                <label className="mb-1 block text-xs font-medium text-ink-muted">Contato (opcional)</label>
                <select className="w-full rounded-[10px] border border-border bg-surface-alt px-3 py-2.5 text-[13px] focus:border-accent focus:outline-none"
                  value={reportContact} onChange={(e) => setReportContact(e.target.value)}>
                  <option value="">Todos</option>
                  {contacts?.map((c) => (
                    <option key={c.id} value={c.id}>{[c.first_name, c.last_name].filter(Boolean).join(' ')}</option>
                  ))}
                </select>
              </div>
              <Button type="submit">Gerar</Button>
              {reportRows && <Button type="button" variant="secondary" onClick={exportCsv}>Exportar CSV</Button>}
            </form>
            {reportError && <div className="mt-2"><ErrorBanner message={reportError} /></div>}
            {reportRows && (
              <div className="mt-3 rounded-[10px] border border-border-light">
                {reportRows.length === 0 && <EmptyState message="Nenhuma cobrança no período." />}
                {reportRows.map((r) => (
                  <div key={r.id} className="flex items-center justify-between border-b border-border-light px-3 py-2 text-[12.5px] last:border-0">
                    <span>{contactName(r)} · {r.description}</span>
                    <span className="font-bold">{formatCurrency(Number(r.value))}</span>
                  </div>
                ))}
                {reportRows.length > 0 && (
                  <div className="flex items-center justify-between px-3 py-2 text-[12.5px] font-extrabold">
                    <span>Total</span>
                    <span>{formatCurrency(reportRows.reduce((s, r) => s + Number(r.value), 0))}</span>
                  </div>
                )}
              </div>
            )}
          </CardBody>
        </Card>
      )}

      {isLoading && <Spinner />}
      {error && <ErrorBanner message={(error as Error).message} />}

      {charges && (
        <Card>
          <CardBody className="divide-y divide-border-light p-0">
            {charges.length === 0 && <EmptyState message="Nenhuma cobrança registrada ainda." />}
            {charges.map((c) => (
              <div key={c.id} className="flex items-center gap-4 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-bold text-ink">{contactName(c)}</p>
                  <p className="truncate text-xs text-ink-muted">{c.description}</p>
                </div>
                <span className="w-24 text-right text-[13px] font-extrabold text-ink">{formatCurrency(Number(c.value))}</span>
                <span className="w-24 text-xs text-ink-muted">{formatDate(c.due_date)}</span>
                <span className="w-28 text-xs text-ink-muted">{paymentMethodLabel(c.payment_method)}</span>
                <button onClick={() => toggleMutation.mutate(c)} title="Clique para alternar pago/pendente">
                  <Badge tone={statusTone[c.status]}>{statusLabel[c.status]}</Badge>
                </button>
              </div>
            ))}
          </CardBody>
        </Card>
      )}
    </div>
  )
}

function StatCard({ label, value, dot, tone }: { label: string; value: string; dot: string; tone?: 'danger' }) {
  return (
    <Card className={tone === 'danger' ? 'border-danger-border' : undefined}>
      <CardBody className="p-4">
        <div className="flex items-center gap-1.5">
          <span className={`h-2 w-2 rounded-full ${dot}`} />
          <span className={`text-xs font-semibold ${tone === 'danger' ? 'text-danger' : 'text-ink-muted'}`}>{label}</span>
        </div>
        <p className={`mt-1.5 text-[26px] font-extrabold tracking-tight ${tone === 'danger' ? 'text-danger' : 'text-ink'}`}>{value}</p>
      </CardBody>
    </Card>
  )
}
