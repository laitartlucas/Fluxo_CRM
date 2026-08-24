import { EmptyState } from './Feedback'

interface RankedBarChartItem {
  label: string
  value: number
}

interface RankedBarChartProps {
  items: RankedBarChartItem[]
  emptyMessage: string
  valueFormatter?: (value: number) => string
  maxItems?: number
}

// Ranking de magnitude por categoria nominal (ex: mensagens por canal) —
// uma única série, então um único hue (accent) e sem legenda: o título do
// card já diz o que está sendo medido. Specs seguidos: barra fina (10px),
// ponta arredondada (4px) no valor, esquadro na base (0), rótulo direto no
// fim da barra em vez de dentro (nunca cortado).
export function RankedBarChart({ items, emptyMessage, valueFormatter, maxItems = 6 }: RankedBarChartProps) {
  const sorted = [...items].sort((a, b) => b.value - a.value).slice(0, maxItems)
  const max = Math.max(1, ...sorted.map((i) => i.value))
  const format = valueFormatter ?? ((v: number) => String(v))

  if (sorted.length === 0) {
    return <EmptyState message={emptyMessage} />
  }

  return (
    <div className="space-y-2.5">
      {sorted.map((item) => (
        <div key={item.label} className="flex items-center gap-2.5">
          <span className="w-[104px] flex-none truncate text-[11.5px] font-semibold text-ink-muted" title={item.label}>
            {item.label}
          </span>
          <div className="min-w-0 flex-1 rounded-[5px] bg-page">
            <div
              className="h-[10px] rounded-r-[4px] bg-accent"
              style={{ width: `${Math.max(4, (item.value / max) * 100)}%` }}
            />
          </div>
          <span className="w-10 flex-none text-right text-[11.5px] font-bold tabular-nums text-ink">
            {format(item.value)}
          </span>
        </div>
      ))}
    </div>
  )
}
