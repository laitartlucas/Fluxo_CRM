import { useState, type FormEvent } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { ErrorBanner } from '../components/ui/Feedback'
import { Card, CardBody } from '../components/ui/Card'

export function LoginPage() {
  const { session, signIn } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  if (session) return <Navigate to="/" replace />

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    const { error } = await signIn(email, password)
    setLoading(false)
    if (error) setError(traduzErro(error))
  }

  return (
    <div className="grid h-screen place-items-center bg-page">
      <div className="w-[380px] max-w-[calc(100vw-48px)]">
        <div className="mb-6 flex items-center justify-center gap-2.5">
          <div className="grid h-9 w-9 place-items-center rounded-[11px] bg-accent">
            <div className="h-3 w-3 rounded-full bg-white" />
          </div>
          <span className="text-[21px] font-extrabold tracking-tight text-ink">Fluxo</span>
        </div>
        <Card>
          <CardBody className="p-7">
            <h1 className="text-[17px] font-extrabold tracking-tight text-ink">Entrar na sua conta</h1>
            <p className="mb-5 mt-1 text-[13px] text-ink-muted">Seu espaço individual de trabalho</p>
            <form onSubmit={handleSubmit} className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-bold text-ink">E-mail</label>
                <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="voce@seunegocio.com" autoFocus />
              </div>
              <div>
                <label className="mb-1 block text-xs font-bold text-ink">Senha</label>
                <Input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
              </div>
              {error && <ErrorBanner message={error} />}
              <Button type="submit" className="mt-1.5 w-full" disabled={loading}>
                {loading ? 'Entrando…' : 'Entrar'}
              </Button>
            </form>
          </CardBody>
        </Card>
        <p className="mt-4 text-center text-[13px] text-ink-muted">
          Novo por aqui? Você precisa ser convidado por um administrador.
        </p>
      </div>
    </div>
  )
}

function traduzErro(message: string): string {
  if (message.includes('Invalid login credentials')) return 'E-mail ou senha incorretos.'
  if (message.includes('deactivated')) return 'Sua conta foi desativada. Fale com um administrador.'
  return message
}
