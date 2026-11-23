import { useMeasure } from "@/hooks/use-measure"
import { fmtDate, fmtTime, pct, shortDecision, verdictKind } from "@/lib/format"
import { useSession } from "@/lib/session"
import type { Assessment } from "@/lib/types"

const COLORS = {
  risk: "var(--risk)",
  safe: "var(--safe)",
  refer: "var(--refer-mark)",
} as const

/** Probability at each assessment, oldest first. Selecting a point opens it. */
export function TrendChart({
  list,
  onOpen,
}: {
  list: Assessment[]
  onOpen: (id: number) => void
}) {
  const { band } = useSession()
  const [ref, measured] = useMeasure<HTMLDivElement>()
  const width = Math.max(300, measured || 640)
  const height = 260
  const m = { l: 44, r: 18, t: 16, b: 34 }

  // A real time axis, unless every visit falls within two days — then space by visit order.
  const real = list.map((a) => new Date(a.created_at).getTime())
  const sameDay =
    real.length > 0 && Math.max(...real) - Math.min(...real) < 2 * 864e5
  const times = sameDay ? list.map((_, i) => i) : real

  let t0 = Math.min(...times)
  let t1 = Math.max(...times)
  if (t1 === t0) {
    t0 -= 1
    t1 += 1
  }
  const pad = (t1 - t0) * 0.08
  t0 -= pad
  t1 += pad

  const sx = (t: number) => m.l + ((t - t0) / (t1 - t0)) * (width - m.l - m.r)
  const sy = (p: number) => m.t + (1 - p) * (height - m.t - m.b)

  const nTicks = Math.min(5, list.length)
  const tickIdx =
    nTicks <= 1
      ? [0]
      : [
          ...new Set(
            Array.from({ length: nTicks }, (_, i) =>
              Math.round((i * (list.length - 1)) / (nTicks - 1))
            )
          ),
        ]

  // Visits close together would print overlapping dates: keep the latest, drop collisions.
  const LABEL_W = sameDay ? 118 : 74
  const kept: number[] = []
  let leftEdge = Infinity
  for (const i of [...tickIdx].reverse()) {
    if (sx(times[i]) + LABEL_W / 2 <= leftEdge) {
      kept.push(i)
      leftEdge = sx(times[i]) - LABEL_W / 2
    }
  }

  if (!list.length) return null

  return (
    <div ref={ref} className="w-full">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Probability of heart disease at each assessment"
        className="block w-full"
      >
        {(
          [
            [0, band.refer_low, "var(--safe-tint)"],
            [band.refer_low, band.refer_high, "var(--refer-tint)"],
            [band.refer_high, 1, "var(--risk-tint)"],
          ] as [number, number, string][]
        ).map(([a, b, fill]) => (
          <rect
            key={fill}
            x={m.l}
            y={sy(b)}
            width={width - m.l - m.r}
            height={sy(a) - sy(b)}
            fill={fill}
            opacity={0.7}
          />
        ))}

        {[0, 0.25, 0.5, 0.75, 1].map((p) => (
          <g key={p}>
            <line
              x1={m.l}
              x2={width - m.r}
              y1={sy(p)}
              y2={sy(p)}
              stroke="var(--border)"
              strokeWidth={1}
            />
            <text
              x={m.l - 8}
              y={sy(p) + 4}
              textAnchor="end"
              className="fill-muted-foreground text-[11px]"
            >
              {p * 100}%
            </text>
          </g>
        ))}

        {kept.map((i) => {
          const anchor =
            tickIdx.length > 1 && i === tickIdx[0]
              ? "start"
              : tickIdx.length > 1 && i === tickIdx[tickIdx.length - 1]
                ? "end"
                : "middle"
          return (
            <text
              key={i}
              x={sx(times[i])}
              y={height - 10}
              textAnchor={anchor}
              className="fill-muted-foreground text-[11px]"
            >
              {sameDay
                ? `Visit ${i + 1}, ${fmtTime(list[i].created_at)}`
                : new Date(times[i]).toLocaleDateString(undefined, {
                    day: "numeric",
                    month: "short",
                    year: "2-digit",
                  })}
            </text>
          )
        })}

        {list.length > 1 && (
          <polyline
            points={list
              .map((a, i) => `${sx(times[i])},${sy(a.probability)}`)
              .join(" ")}
            fill="none"
            stroke="var(--foreground)"
            strokeWidth={2}
            strokeLinejoin="round"
          />
        )}

        {list.map((a, i) => (
          <g
            key={a.id}
            role="button"
            tabIndex={0}
            className="cursor-pointer focus-visible:outline-2 focus-visible:outline-ring"
            aria-label={`${fmtDate(a.created_at)}: ${pct(a.probability)}, ${a.decision}`}
            onClick={() => onOpen(a.id)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault()
                onOpen(a.id)
              }
            }}
          >
            <title>{`${fmtDate(a.created_at)}: ${pct(a.probability)} (${shortDecision(a.decision)})`}</title>
            <circle
              cx={sx(times[i])}
              cy={sy(a.probability)}
              r={6}
              fill={COLORS[verdictKind(a.decision)]}
              stroke="var(--card)"
              strokeWidth={2}
            />
            {list.length <= 12 && (
              <text
                x={sx(times[i])}
                y={sy(a.probability) - 12}
                textAnchor="middle"
                className="fill-foreground text-[11px] font-semibold"
              >
                {pct(a.probability)}
              </text>
            )}
          </g>
        ))}
      </svg>
    </div>
  )
}
