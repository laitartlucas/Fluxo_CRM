import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import type { Contact } from '../lib/types'
import { Card, CardBody } from '../components/ui/Card'
import { Input } from '../components/ui/Input'
import { Spinner, ErrorBanner, EmptyState } from '../components/ui/Feedback'
import { channelLabel } from '../lib/format'
import { useRealtimeTable } from '../hooks/useRealtimeTable'

type ContactRow = Contact & { companies: { name: string } | null }

export function ContactsPage() {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')

  const queryKey = ['contacts-list']
  const { data, isLoading, error } = useQuery({
    queryKey,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('contacts')
        .select('*, companies(name)')
        .order('first_name')
      if (error) throw error
      return data as ContactRow[]
    },
  })

  useRealtimeTable(queryClient, 'contacts', [queryKey])

  const filtered = data?.filter((c) => {
    const name = `${c.first_name} ${c.last_name ?? ''}`.toLowerCase()
    return name.includes(search.toLowerCase())
  })

  return (
    <div className="animate-fade-up space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="mr-auto">
          <h1 className="text-[22px] font-extrabold tracking-tight text-ink">Contatos</h1>
          <p className="mt-0.5 text-[13px] text-ink-muted">{data ? `${data.length} no total` : ' '}</p>
        </div>
        <Input placeholder="Buscar contato…" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-xs" />
      </div>

      {isLoading && <Spinner />}
      {error && <ErrorBanner message={(error as Error).message} />}

      {filtered && (
        <Card>
          <CardBody className="p-0">
            <div className="grid grid-cols-[2fr_1fr_1fr_1.2fr] gap-3 border-b border-border bg-surface-alt px-[18px] py-3 text-[11px] font-extrabold uppercase tracking-wide text-ink-muted">
              <span>Contato</span><span>Empresa</span><span>Origem</span><span>Telefone</span>
            </div>
            {filtered.length === 0 && <EmptyState message="Nenhum contato encontrado." />}
            {filtered.map((c) => (
              <Link
                key={c.id}
                to={`/contacts/${c.id}`}
                className="grid grid-cols-[2fr_1fr_1fr_1.2fr] items-center gap-3 border-b border-border-light px-[18px] py-3 last:border-0 hover:bg-page"
              >
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-bold text-ink">{c.first_name} {c.last_name}</p>
                  <p className="truncate text-xs text-ink-muted">{c.email}</p>
                </div>
                <span className="truncate text-xs text-ink-muted">{c.companies?.name ?? '—'}</span>
                <span className="text-xs text-ink-muted">{c.source ? channelLabel(c.source) : '—'}</span>
                <span className="text-xs text-ink-muted">{c.phone ?? '—'}</span>
              </Link>
            ))}
          </CardBody>
        </Card>
      )}
    </div>
  )
}
