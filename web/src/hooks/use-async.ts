import * as React from "react"

export interface AsyncState<T> {
  data: T | null
  error: string | null
  loading: boolean
  reload: () => void
}

interface Loaded<T> {
  key: string
  data: T | null
  error: string | null
}

/**
 * Loads data for a page and gives it a way to reload after a change. Each load
 * is stamped with the key it was started for, so a result that arrives after
 * the page has moved on is ignored rather than shown.
 */
export function useAsync<T>(
  load: () => Promise<T>,
  deps: React.DependencyList
): AsyncState<T> {
  const [nonce, setNonce] = React.useState(0)
  const key = JSON.stringify(deps) + "#" + nonce
  const [loaded, setLoaded] = React.useState<Loaded<T> | null>(null)

  // The caller passes a fresh closure every render; only the key should re-run it.
  const loadRef = React.useRef(load)
  React.useEffect(() => {
    loadRef.current = load
  })

  React.useEffect(() => {
    let alive = true
    loadRef
      .current()
      .then((data) => {
        if (alive) setLoaded({ key, data, error: null })
      })
      .catch((ex: unknown) => {
        if (alive) setLoaded({ key, data: null, error: (ex as Error).message })
      })
    return () => {
      alive = false
    }
  }, [key])

  const reload = React.useCallback(() => setNonce((n) => n + 1), [])
  const fresh = loaded?.key === key

  return {
    // Keep showing the previous data while a reload is in flight.
    data: loaded?.data ?? null,
    error: fresh ? loaded.error : null,
    loading: !fresh,
    reload,
  }
}
