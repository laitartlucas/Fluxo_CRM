import { usePresence } from '../hooks/usePresence'

export function PresenceBar({ room }: { room: string }) {
  const present = usePresence(room)

  if (present.length === 0) return null

  return (
    <div className="flex items-center gap-2 text-xs text-ink-muted">
      <span>Vendo agora:</span>
      <div className="flex -space-x-2">
        {present.map((u) => (
          <span
            key={u.user_id}
            title={u.full_name}
            className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-white bg-accent text-[10px] font-medium text-white"
          >
            {initials(u.full_name)}
          </span>
        ))}
      </div>
    </div>
  )
}

function initials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('')
}
