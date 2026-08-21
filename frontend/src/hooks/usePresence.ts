import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthContext'

export interface PresentUser {
  user_id: string
  full_name: string
}

// Ephemeral presence via a dedicated Realtime channel — never persisted to
// a table. One channel per "room" (e.g. `opportunity:<id>`); each browser
// tab tracks itself and receives the synced list of everyone else present.
export function usePresence(room: string) {
  const { profile } = useAuth()
  const [present, setPresent] = useState<PresentUser[]>([])

  useEffect(() => {
    if (!profile) return

    const channel = supabase.channel(`presence:${room}`, {
      config: { presence: { key: profile.id } },
    })

    channel
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState<PresentUser>()
        const users = Object.values(state)
          .flat()
          .filter((u) => u.user_id !== profile.id)
        setPresent(users)
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await channel.track({ user_id: profile.id, full_name: profile.full_name ?? profile.email })
        }
      })

    return () => {
      supabase.removeChannel(channel)
    }
  }, [room, profile])

  return present
}
