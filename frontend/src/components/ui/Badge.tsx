import clsx from 'clsx'

type Tone = 'slate' | 'green' | 'red' | 'amber' | 'indigo'

const toneClasses: Record<Tone, string> = {
  slate: 'bg-page text-ink-muted',
  green: 'bg-success-light text-success-ink',
  red: 'bg-danger-light text-danger',
  amber: 'bg-warning/15 text-warning',
  indigo: 'bg-accent-light text-accent',
}

export function Badge({ tone = 'slate', children }: { tone?: Tone; children: React.ReactNode }) {
  return (
    <span className={clsx('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium', toneClasses[tone])}>
      {children}
    </span>
  )
}
