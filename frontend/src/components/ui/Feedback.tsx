export function Spinner({ label = 'Carregando…' }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 py-8 text-sm text-ink-muted">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-border border-t-accent" />
      {label}
    </div>
  )
}

export function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="rounded-[10px] border border-danger-border bg-danger-light px-3 py-2 text-sm text-danger">
      {message}
    </div>
  )
}

export function EmptyState({ message }: { message: string }) {
  return <div className="py-8 text-center text-sm text-ink-faint">{message}</div>
}
