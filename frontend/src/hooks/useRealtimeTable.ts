import { useEffect } from 'react'
import type { QueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

// Subscribes to Postgres Changes for one table and simply invalidates the
// given query keys on any INSERT/UPDATE/DELETE. Supabase Realtime
// re-evaluates RLS per change, so a client only ever receives events for
// rows it's allowed to see — this never needs its own permission check.
export function useRealtimeTable(queryClient: QueryClient, table: string, queryKeys: unknown[][]) {
  useEffect(() => {
    const channel = supabase
      .channel(`realtime:${table}:${Math.random().toString(36).slice(2)}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table },
        () => {
          queryKeys.forEach((key) => queryClient.invalidateQueries({ queryKey: key }))
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table])
}
