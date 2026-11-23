import { pct } from "@/lib/format"
import { useSession } from "@/lib/session"

/**
 * A single probability placed on the 0–100% scale, with the referral band marked.
 * Used in tables, where a full risk strip would not fit.
 */
export function PositionBar({ probability }: { probability: number }) {
  const { band } = useSession()
  const lo = band.refer_low * 100
  const hi = band.refer_high * 100

  return (
    <span
      className="relative block h-2 w-28 overflow-hidden rounded-full bg-safe-tint"
      role="img"
      aria-label={`Probability ${pct(probability)} on the 0 to 100 percent scale`}
    >
      <span
        className="absolute inset-y-0 bg-refer-tint"
        style={{ left: `${lo}%`, width: `${hi - lo}%` }}
      />
      <span
        className="absolute inset-y-0 right-0 bg-risk-tint"
        style={{ left: `${hi}%` }}
      />
      <span
        className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-card bg-foreground"
        style={{ left: `${Math.max(0, Math.min(1, probability)) * 100}%` }}
      />
    </span>
  )
}
