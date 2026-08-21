import { useParams, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import type { Company, Contact, Opportunity } from '../lib/types'
import { Card, CardBody, CardHeader } from '../components/ui/Card'
import { Spinner, ErrorBanner, EmptyState } from '../components/ui/Feedback'
import { Timeline } from '../components/Timeline'
import { formatCurrency } from '../lib/format'

export function CompanyDetailPage() {
  const { id } = useParams<{ id: string }>()

  const { data: company, isLoading, error } = useQuery({
    queryKey: ['company', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('companies').select('*').eq('id', id!).maybeSingle()
      if (error) throw error
      return data as Company | null
    },
  })

  const { data: contacts } = useQuery({
    queryKey: ['company-contacts', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('contacts').select('*').eq('company_id', id!).order('first_name')
      if (error) throw error
      return data as Contact[]
    },
  })

  const { data: opportunities } = useQuery({
    queryKey: ['company-opportunities', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('opportunities').select('*').eq('company_id', id!).order('created_at', { ascending: false })
      if (error) throw error
      return data as Opportunity[]
    },
  })

  if (isLoading) return <Spinner />
  if (error) return <ErrorBanner message={(error as Error).message} />
  if (!company) return <ErrorBanner message="Empresa não encontrada (ou fora do seu escopo de acesso)." />

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[22px] font-extrabold tracking-tight text-ink">{company.name}</h1>
        <p className="text-sm text-ink-muted">{company.domain}</p>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader className="font-medium text-ink">Contatos</CardHeader>
            <CardBody className="divide-y divide-border-light p-0">
              {!contacts?.length && <EmptyState message="Nenhum contato cadastrado." />}
              {contacts?.map((c) => (
                <Link key={c.id} to={`/contacts/${c.id}`} className="flex items-center justify-between px-4 py-2 hover:bg-page">
                  <span className="text-sm text-ink">{c.first_name} {c.last_name}</span>
                  <span className="text-xs text-ink-faint">{c.email}</span>
                </Link>
              ))}
            </CardBody>
          </Card>

          <Card>
            <CardHeader className="font-medium text-ink">Oportunidades</CardHeader>
            <CardBody className="divide-y divide-border-light p-0">
              {!opportunities?.length && <EmptyState message="Nenhuma oportunidade." />}
              {opportunities?.map((o) => (
                <Link key={o.id} to={`/opportunities/${o.id}`} className="flex items-center justify-between px-4 py-2 hover:bg-page">
                  <span className="text-sm text-ink">{o.name}</span>
                  <span className="text-xs text-ink-faint">{formatCurrency(Number(o.value))}</span>
                </Link>
              ))}
            </CardBody>
          </Card>
        </div>

        <Card>
          <CardHeader className="font-medium text-ink">Histórico</CardHeader>
          <CardBody>
            <Timeline relatedToType="company" relatedToId={company.id} />
          </CardBody>
        </Card>
      </div>
    </div>
  )
}
