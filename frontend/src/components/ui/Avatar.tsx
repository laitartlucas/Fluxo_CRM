function initials(name: string): string {
  return name.split(' ').filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('')
}

export function Avatar({ name, size = 34 }: { name: string; size?: number }) {
  return (
    <div
      className="grid flex-none place-items-center rounded-full bg-accent-light font-extrabold text-accent"
      style={{ width: size, height: size, fontSize: size * 0.36 }}
    >
      {initials(name) || '?'}
    </div>
  )
}
