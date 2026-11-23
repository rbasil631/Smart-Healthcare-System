import type { Role } from "@/lib/types"

export const pct = (p: number, d = 0) => `${(p * 100).toFixed(d)}%`

/** SHAP contributions read as percentage points, with a true minus sign. */
export const pts = (v: number) =>
  Math.abs(v) < 0.0005
    ? "0.0 pts"
    : `${v >= 0 ? "+" : "−"}${Math.abs(v * 100).toFixed(1)} pts`

export const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  })

export const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  })

export const sexWord = (s: number | undefined) =>
  Number(s) === 1 ? "male" : "female"

export const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`

export type VerdictKind = "risk" | "safe" | "refer"

export function verdictKind(decision: string): VerdictKind {
  if (decision.startsWith("Disease")) return "risk"
  if (decision.startsWith("No disease")) return "safe"
  return "refer"
}

/** The full decision repeats itself inside a table cell. */
export const shortDecision = (d: string) =>
  d.replace(" - refer to clinician", "")

export const roleWord = (r: Role) => r.charAt(0).toUpperCase() + r.slice(1)
