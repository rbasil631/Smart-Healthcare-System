import * as React from "react"

import { api, onSessionLost } from "@/lib/api"
import type { Band, ModelInfo, User } from "@/lib/types"

/** Fallback band and threshold, replaced by /api/model as soon as it answers. */
const DEFAULT_BAND: Band = { refer_low: 0.39, refer_high: 0.61 }
const DEFAULT_THRESHOLD = 0.385

interface SessionState {
  user: User | null
  model: ModelInfo | null
  band: Band
  threshold: number
  /** False until the cookie has been checked, so the app does not flash sign-in. */
  ready: boolean
  setUser: (user: User | null) => void
  signOut: () => Promise<void>
}

const SessionContext = React.createContext<SessionState | undefined>(undefined)

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [user, setUserState] = React.useState<User | null>(null)
  const [model, setModel] = React.useState<ModelInfo | null>(null)
  const [ready, setReady] = React.useState(false)

  React.useEffect(() => {
    let alive = true
    api
      .me()
      .then((u) => {
        if (alive) setUserState(u)
      })
      .catch(() => {
        /* not signed in */
      })
      .finally(() => {
        if (alive) setReady(true)
      })
    return () => {
      alive = false
    }
  }, [])

  // The model card is the same for everyone, so it is fetched once per session.
  React.useEffect(() => {
    if (!user || model) return
    let alive = true
    api
      .model()
      .then((m) => {
        if (alive) setModel(m)
      })
      .catch(() => {
        /* the model page reports this itself */
      })
    return () => {
      alive = false
    }
  }, [user, model])

  React.useEffect(() => onSessionLost(() => setUserState(null)), [])

  const setUser = React.useCallback((u: User | null) => setUserState(u), [])

  const signOut = React.useCallback(async () => {
    try {
      await api.logout()
    } catch {
      // the cookie is cleared locally either way
    }
    setUserState(null)
    window.history.replaceState(null, "", window.location.pathname)
  }, [])

  const value = React.useMemo<SessionState>(
    () => ({
      user,
      model,
      band: model?.band ?? DEFAULT_BAND,
      threshold: model?.threshold ?? DEFAULT_THRESHOLD,
      ready,
      setUser,
      signOut,
    }),
    [user, model, ready, setUser, signOut]
  )

  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  )
}

export function useSession() {
  const ctx = React.useContext(SessionContext)
  if (!ctx) throw new Error("useSession must be used within a SessionProvider")
  return ctx
}

/** For the many places that only run once a user is known to be signed in. */
export function useUser() {
  const { user } = useSession()
  if (!user) throw new Error("useUser called while signed out")
  return user
}
