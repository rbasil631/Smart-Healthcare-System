import * as React from "react"

/** Width of an element, kept up to date so SVG charts can lay themselves out. */
export function useMeasure<T extends HTMLElement>(): [
  React.RefObject<T | null>,
  number,
] {
  const ref = React.useRef<T>(null)
  const [width, setWidth] = React.useState(0)

  React.useEffect(() => {
    const node = ref.current
    if (!node) return
    const observer = new ResizeObserver(([entry]) => {
      setWidth(Math.round(entry.contentRect.width))
    })
    observer.observe(node)
    setWidth(Math.round(node.clientWidth))
    return () => observer.disconnect()
  }, [])

  return [ref, width]
}
