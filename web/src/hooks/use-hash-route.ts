import * as React from "react"

export interface HashRoute {
  view: string
  arg: string | undefined
}

function read(): HashRoute {
  const [view, arg] = window.location.hash.slice(1).split("/")
  return { view, arg }
}

/** The app keeps the hash router of the first version, so every link still works. */
export function useHashRoute(): HashRoute {
  const [route, setRoute] = React.useState<HashRoute>(read)

  React.useEffect(() => {
    const onChange = () => setRoute(read())
    window.addEventListener("hashchange", onChange)
    return () => window.removeEventListener("hashchange", onChange)
  }, [])

  return route
}

export const go = (hash: string) => {
  window.location.hash = hash
}
