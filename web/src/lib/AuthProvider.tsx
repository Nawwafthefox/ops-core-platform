import React, { createContext, useContext, useEffect, useMemo, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabaseClient'
import type { MyContextRow } from './types'

type AuthState = {
  session: Session | null
  ctx: MyContextRow | null
  loading: boolean
  refreshContext: () => Promise<void>
  signOut: () => Promise<void>
}

const Ctx = createContext<AuthState | undefined>(undefined)

export function useAuth() {
  const v = useContext(Ctx)
  if (!v) throw new Error('useAuth must be used inside <AuthProvider/>')
  return v
}

async function fetchMyContext(): Promise<MyContextRow | null> {
  const { data, error } = await supabase.from('v_my_context').select('*').maybeSingle()
  if (error) {
    // If user exists but isn't bootstrapped yet, v_my_context will be empty. We treat as null.
    // eslint-disable-next-line no-console
    console.warn('v_my_context error:', error.message)
    return null
  }
  return (data as MyContextRow) ?? null
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [ctx, setCtx] = useState<MyContextRow | null>(null)
  const [loading, setLoading] = useState(true)

  const refreshContext = async () => {
    if (!session?.user) {
      setCtx(null)
      return
    }
    const c = await fetchMyContext()
    setCtx(c)
  }

  const signOut = async () => {
    await supabase.auth.signOut()
  }

  useEffect(() => {
    
    (async () => {
      try {
        const { data, error } = await supabase.rpc('rpc_whoami');
        console.log('[rpc_whoami]', { data, error });
      } catch (e) {
        console.log('[rpc_whoami]', e);
      }
    })();
let mounted = true

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return
      setSession(data.session ?? null)
      setLoading(false)
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession ?? null)
    })

    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    // Fetch context whenever session changes
    ;(async () => {
      if (!session?.user) {
        setCtx(null)
        return
      }
      const c = await fetchMyContext()
      setCtx(c)
    })()
  }, [session?.user?.id])

  const value = useMemo<AuthState>(
    () => ({
      session,
      ctx,
      loading,
      refreshContext,
      signOut,
    }),
    [session, ctx, loading],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
