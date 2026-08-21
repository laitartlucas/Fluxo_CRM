import { useParams, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import type { Contact, Company } from '../lib/types'
import { Card, CardBody, CardHeader } from '../components/ui/Card'
import { Spinner, ErrorBanner } from '../components/ui/Feedback'
import { Timeline } from '../components/Timeline'

export function ContactDetailPage() {
  const { id } = useParams<{ id: string }>()

  const { data: contact, isLoading, error } = useQuery({
    queryKey: ['contact', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('contacts').select('*').eq('id', id!).maybeSingle()
      if (error) throw error
      return data as Contact | null
    },
  })

  const { data: company } = useQuery({
    queryKey: ['contact-company', contact?.company_id],
    enabled: !!contact?.company_id,
    queryFn: async () => {
      const { data, error } = await supabase.from('companies').select('*').eq('id', contact!.company_id!).maybeSingle()
      if (error) throw error
      return data as Company | null
    },
  })

  if (isLoading) return <Spinner />
  if (error) return <ErrorBanner message={(error as Error).message} />
  if (!contact) return <ErrorBanner message="Contato não encontrado (ou fora do seu escopo de acesso)." />

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[22px] font-extrabold tracking-tight text-ink">{contact.first_name} {contact.last_name}</h1>
        <p className="text-sm text-ink-muted">
          {contact.job_title}
          {company && (
            <>
              {' · '}
              <Link to={`/companies/${company.id}`} className="text-accent hover:underline">{company.name}</Link>
            </>
          )}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="font-medium text-ink">Dados de contato</CardHeader>
          <CardBody className="space-y-1 text-sm text-ink-muted">
            <p>E-mail: {contact.email ?? '—'}</p>
            <p>Telefone: {contact.phone ?? '—'}</p>
            <p>Notas: {contact.notes ?? '—'}</p>
          </CardBody>
        </Card>

        <Card>
          <CardHeader className="font-medium text-ink">Histórico</CardHeader>
          <CardBody>
            <Timeline relatedToType="contact" relatedToId={contact.id} />
          </CardBody>
        </Card>
      </div>
    </div>
  )
}
