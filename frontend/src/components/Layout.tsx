import { useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { useAuth } from '../auth/AuthContext'
import { supabase } from '../lib/supabase'

// Grouped to mirror the mockup: Dashboard/Pipeline/Contatos/Agenda/
// Financeiro/Mensagens live together under "Comercial CRM" (the core
// day-to-day sales flow); everything else is a separate module below it.
const comercialItems = [
  { to: '/', label: 'Dashboard', d: 'M3 12l9-9 9 9M5 10v10h14V10' },
  { to: '/pipeline', label: 'Pipeline', d: 'M4 20V10M12 20V4M20 20v-7' },
  { to: '/contacts', label: 'Contatos', d: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75' },
  { to: '/agenda', label: 'Agenda', d: 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z' },
  { to: '/financeiro', label: 'Financeiro', d: 'M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6' },
  { to: '/conversas', label: 'Conversas', d: 'M4 5h16v11H9l-5 4zM8 9h8M8 12h5' },
]

const otherItems = [
  { to: '/companies', label: 'Empresas', d: 'M3 21h18M6 21V7l6-4 6 4v14M9 9h.01M9 13h.01M15 9h.01M15 13h.01' },
  { to: '/tasks', label: 'Tarefas', d: 'M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11' },
  { to: '/marketing', label: 'Marketing', d: 'M3 11l18-8-8 18-2-8-8-2z' },
  { to: '/sucesso-cliente', label: 'Sucesso do Cliente', d: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21c0-4 3.6-6 8-6s8 2 8 6' },
  { to: '/disparos', label: 'Disparos', d: 'M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z' },
  { to: '/fluxos', label: 'Fluxos', d: 'M13 2L3 14h9l-1 8 10-12h-9l1-8z' },
  { to: '/atendente-ia', label: 'Atendente IA', d: 'M12 2v4M8 6h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2zM9 12h.01M15 12h.01M9 16h6' },
  { to: '/contas', label: 'Contas', d: 'M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1' },
  { to: '/ajustes', label: 'Ajustes', d: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z' },
]

function NavItem({ to, label, d }: { to: string; label: string; d: string }) {
  return (
    <NavLink
      to={to}
      end={to === '/'}
      className={({ isActive }) =>
        clsx(
          'flex items-center gap-2.5 rounded-[10px] px-3 py-2.5 text-[13px] font-semibold transition-colors',
          isActive ? 'bg-accent-light text-accent' : 'text-ink-muted hover:bg-page hover:text-ink'
        )
      }
    >
      <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="flex-none">
        <path d={d} />
      </svg>
      <span>{label}</span>
    </NavLink>
  )
}

function initials(name: string): string {
  return name.split(' ').filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('')
}

export function Layout() {
  const { profile, signOut } = useAuth()
  const canInvite = profile?.is_platform_admin ?? false
  const location = useLocation()
  const [comercialOpen, setComercialOpen] = useState(() =>
    comercialItems.some((item) => (item.to === '/' ? location.pathname === '/' : location.pathname.startsWith(item.to)))
  )

  const { data: unreadCount } = useQuery({
    queryKey: ['unread-notifications', profile?.id],
    enabled: !!profile,
    refetchInterval: 30_000,
    queryFn: async () => {
      const { count, error } = await supabase
        .from('notification')
        .select('id', { count: 'exact', head: true })
        .is('read_at', null)
      if (error) throw error
      return count ?? 0
    },
  })

  const displayName = profile?.full_name ?? profile?.email ?? ''

  return (
    <div className="flex h-screen overflow-hidden bg-page">
      <aside className="flex w-[228px] flex-none flex-col border-r border-border bg-surface p-3.5">
        <div className="flex items-center gap-2.5 px-2.5 pb-5 pt-1">
          <div className="grid h-[30px] w-[30px] flex-none place-items-center rounded-[9px] bg-accent">
            <div className="h-2.5 w-2.5 rounded-full bg-white" />
          </div>
          <span className="text-[17px] font-extrabold tracking-tight text-ink">Fluxo</span>
        </div>

        <nav className="flex flex-col gap-3.5 overflow-y-auto">
          <div>
            <button
              onClick={() => setComercialOpen((v) => !v)}
              className="flex w-full items-center gap-1.5 rounded-[8px] px-3 py-1.5 text-[10.5px] font-extrabold uppercase tracking-wide text-ink-faint hover:bg-page hover:text-ink-muted"
            >
              <span>Comercial CRM</span>
              <svg
                width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round"
                className={clsx('ml-auto transition-transform', comercialOpen ? 'rotate-90' : 'rotate-0')}
              >
                <path d="M9 6l6 6-6 6" />
              </svg>
            </button>
            {comercialOpen && (
              <div className="mt-1 flex flex-col gap-0.5">
                {comercialItems.map((item) => <NavItem key={item.to} {...item} />)}
              </div>
            )}
          </div>
          <div>
            <div className="flex flex-col gap-0.5">
              {otherItems.map((item) => <NavItem key={item.to} {...item} />)}
              {canInvite && (
                <NavItem
                  to="/invite"
                  label="Convidar"
                  d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM20 8v6M23 11h-6"
                />
              )}
            </div>
          </div>
        </nav>

        <div className="mt-auto flex items-center gap-2.5 rounded-xl bg-page p-3">
          <div className="grid h-[34px] w-[34px] flex-none place-items-center rounded-full bg-accent-light text-[12px] font-extrabold text-accent">
            {initials(displayName)}
          </div>
          <div className="min-w-0">
            <div className="truncate text-[13px] font-bold text-ink">{displayName}</div>
            <button onClick={() => signOut()} className="text-[11px] font-semibold text-ink-muted hover:text-accent">
              Sair
            </button>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex flex-none items-center gap-4 border-b border-border bg-surface px-7 py-3.5">
          <div className="flex-1" />
          <button className="relative grid h-9 w-9 flex-none place-items-center rounded-[10px] border border-border bg-surface text-ink-muted hover:bg-page">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 9a6 6 0 0 0-12 0c0 6-2 7-2 7h16s-2-1-2-7M10.5 20a2 2 0 0 0 3 0" />
            </svg>
            {!!unreadCount && unreadCount > 0 && (
              <span className="absolute right-1.5 top-1.5 h-[7px] w-[7px] rounded-full border-[1.5px] border-surface bg-danger" />
            )}
          </button>
        </header>
        <main className="flex-1 overflow-auto px-7 py-[26px]">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
