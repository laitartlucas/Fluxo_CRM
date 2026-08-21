// Reached via the invite email's link. Supabase's client detects the
// session from the URL fragment automatically on load, so by the time
// this renders, useAuth() already has a (temporary) session for the
// invited user — they just need to set a real password to finish setup.
import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthContext'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { ErrorBanner } from '../components/ui/Feedback'
import { Card, CardBody } from '../components/ui/Card'

export function AcceptInvitePage() {
  const { session, loading } = useAuth()
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (password.length < 8) {
      setError('A senha precisa ter pelo menos 8 caracteres.')
      return
    }
    if (password !== confirmPassword) {
      setError('As senhas não coincidem.')
      return
    }
    setSubmitting(true)
    const { error } = await supabase.auth.updateUser({ password })
    setSubmitting(false)
    if (error) {
      setError(error.message)
      return
    }
    navigate('/', { replace: true })
  }

  if (loading) return null

  if (!session) {
    return (
      <div className="flex h-screen items-center justify-center bg-page px-4 text-center text-sm text-ink-muted">
        Link de convite inválido ou expirado. Peça para um administrador reenviar o convite.
      </div>
    )
  }

  return (
    <div className="flex h-screen items-center justify-center bg-page">
      <Card className="w-full max-w-sm">
        <CardBody>
          <h1 className="mb-1 text-[22px] font-extrabold tracking-tight text-ink">Bem-vindo(a)!</h1>
          <p className="mb-6 text-sm text-ink-muted">Defina sua senha para começar a usar o sistema.</p>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-ink-muted">Nova senha</label>
              <Input type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-ink-muted">Confirmar senha</label>
              <Input type="password" required minLength={8} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
            </div>
            {error && <ErrorBanner message={error} />}
            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? 'Salvando…' : 'Criar senha e entrar'}
            </Button>
          </form>
        </CardBody>
      </Card>
    </div>
  )
}
