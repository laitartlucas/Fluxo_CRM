import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthContext'
import type { Company } from '../lib/types'
import { Card, CardBody } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { Spinner, ErrorBanner, EmptyState } from '../components/ui/Feedback'
import { useRealtimeTable } from '../hooks/useRealtimeTable'

export function CompaniesPage() {
  const { profile } = useAuth()
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [name, setName] = useState('')
  const [domain, setDomain] = useState('')
  const [formError, setFormError] = useState<string | null>(null)

  const queryKey = ['companies']
  const { data, isLoading, error } = useQuery({
    queryKey,
    queryFn: async () => {
      const { data, error } = await supabase.from('companies').select('*').order('name')
      if (error) throw error
      return data as Company[]
    },
  })

  useRealtimeTable(queryClient, 'companies', [queryKey])

  const createMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('companies').insert({
        name,
        domain: domain || null,
        owner_id: profile!.id,
      })
      if (error) throw error
    },
    onSuccess: () => {
      setName('')
      setDomain('')
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

  const filtered = data?.filter((c) => c.name.toLowerCase().includes(search.toLowerCase()))

  return (
    <div className="animate-fade-up space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="mr-auto">
          <h1 className="text-[22px] font-extrabold tracking-tight text-ink">Empresas</h1>
          <p className="mt-0.5 text-[13px] text-ink-muted">{data ? `${data.length} no total` : ' '}</p>
        </div>
        <Input placeholder="Buscar empresa…" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-xs" />
        <Button onClick={() => setShowForm((v) => !v)}>{showForm ? 'Cancelar' : 'Nova empresa'}</Button>
      </div>

      {showForm && (
        <Card>
          <CardBody>
            <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3">
              <div className="flex-1 min-w-[200px]">
                <label className="mb-1 block text-xs font-medium text-ink-muted">Nome</label>
                <Input required value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="flex-1 min-w-[200px]">
                <label className="mb-1 block text-xs font-medium text-ink-muted">Domínio</label>
                <Input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="empresa.com" />
              </div>
              <Button type="submit" disabled={createMutation.isPending}>
                {createMutation.isPending ? 'Salvando…' : 'Salvar'}
              </Button>
            </form>
            {formError && <div className="mt-2"><ErrorBanner message={formError} /></div>}
          </CardBody>
        </Card>
      )}

      {isLoading && <Spinner />}
      {error && <ErrorBanner message={(error as Error).message} />}

      {filtered && (
        <Card>
          <CardBody className="divide-y divide-border-light p-0">
            {filtered.length === 0 && <EmptyState message="Nenhuma empresa encontrada." />}
            {filtered.map((company) => (
              <Link
                key={company.id}
                to={`/companies/${company.id}`}
                className="flex items-center justify-between px-4 py-3 hover:bg-page"
              >
                <span className="text-sm font-medium text-ink">{company.name}</span>
                <span className="text-xs text-ink-faint">{company.domain}</span>
              </Link>
            ))}
          </CardBody>
        </Card>
      )}
    </div>
  )
}
