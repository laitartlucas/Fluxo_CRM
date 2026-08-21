// Placeholder: WhatsApp integration (Evolution API) is not wired up yet —
// it needs a self-hosted Evolution API instance URL + API key from the
// user before any real messaging can happen (documented in the project
// conversation, not something this page can provision itself).
import { Card, CardBody } from '../components/ui/Card'

export function MensagensPage() {
  return (
    <div className="animate-fade-up space-y-4">
      <div>
        <h1 className="text-[22px] font-extrabold tracking-tight text-ink">Mensagens</h1>
        <p className="mt-0.5 text-[13px] text-ink-muted">Histórico de conversas e templates rápidos</p>
      </div>

      <Card>
        <CardBody className="flex flex-col items-center gap-3 py-16 text-center">
          <div className="grid h-14 w-14 place-items-center rounded-full bg-accent-light">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" className="text-accent">
              <path d="M4 5h16v11H9l-5 4zM8 9h8M8 12h5" />
            </svg>
          </div>
          <p className="text-[15px] font-extrabold text-ink">WhatsApp ainda não conectado</p>
          <p className="max-w-sm text-[13px] text-ink-muted">
            Essa integração precisa de uma instância própria da Evolution API rodando (self-hosted) — assim que você tiver a URL e a API key dela, é só me passar que eu conecto de verdade.
          </p>
        </CardBody>
      </Card>
    </div>
  )
}
