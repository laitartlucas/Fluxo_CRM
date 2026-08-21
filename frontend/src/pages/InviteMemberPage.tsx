import { useState, type FormEvent } from 'react'
import { useMutation } from '@tanstack/react-query'
import { inviteMember, ApiError } from '../lib/api'
import { Card, CardBody } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { ErrorBanner } from '../components/ui/Feedback'

export function InviteMemberPage() {
  const [email, setEmail] = useState('')
  const [fullName, setFullName] = useState('')
  const [businessName, setBusinessName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: () => inviteMember(email, fullName || undefined, businessName || undefined),
    onSuccess: (data) => {
      setSuccess(`Convite enviado para ${data.email}. A conta dela já nasce com um funil de vendas pronto para usar.`)
      setEmail('')
      setFullName('')
      setBusinessName('')
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : 'Não foi possível enviar o convite.')
    },
  })

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSuccess(null)
    mutation.mutate()
  }

  return (
    <div className="max-w-md">
      <h1 className="mb-4 text-[22px] font-extrabold tracking-tight text-ink">Convidar nova mentorada</h1>
      <Card>
        <CardBody>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-ink-muted">E-mail</label>
              <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-ink-muted">Nome completo (opcional)</label>
              <Input value={fullName} onChange={(e) => setFullName(e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-ink-muted">Nome do negócio (opcional)</label>
              <Input value={businessName} onChange={(e) => setBusinessName(e.target.value)} placeholder="ex: Estúdio Ana" />
            </div>
            {error && <ErrorBanner message={error} />}
            {success && <p className="rounded-[10px] border border-success-border bg-success-light px-3 py-2 text-sm text-success-ink">{success}</p>}
            <Button type="submit" className="w-full" disabled={mutation.isPending}>
              {mutation.isPending ? 'Enviando…' : 'Enviar convite'}
            </Button>
          </form>
        </CardBody>
      </Card>
      <p className="mt-3 text-xs text-ink-faint">
        Cada conta é totalmente isolada — só o admin da plataforma pode criar novas contas (permissão validada no servidor, não só aqui).
      </p>
    </div>
  )
}
