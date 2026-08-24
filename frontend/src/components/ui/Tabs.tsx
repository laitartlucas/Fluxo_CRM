import clsx from 'clsx'

interface TabsProps<T extends string> {
  tabs: { value: T; label: string }[]
  active: T
  onChange: (value: T) => void
}

export function Tabs<T extends string>({ tabs, active, onChange }: TabsProps<T>) {
  return (
    <div className="flex gap-1 rounded-[10px] border border-border bg-page p-1">
      {tabs.map((tab) => (
        <button
          key={tab.value}
          onClick={() => onChange(tab.value)}
          className={clsx(
            'flex-1 rounded-[8px] px-3 py-1.5 text-[12.5px] font-bold transition-colors',
            active === tab.value ? 'bg-surface text-ink shadow-sm' : 'text-ink-muted hover:text-ink'
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}
