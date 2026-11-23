import * as React from "react"

import { useMeasure } from "@/hooks/use-measure"
import { pct } from "@/lib/format"
import { useSession } from "@/lib/session"

const BASE_Y = 150
const TOP_Y = 34

/** One ECG beat (P, QRS, T) about 110 wide, scaled by `a`, starting at `x0`. */
function beat(x0: number, a: number, peak: number | null = null) {
  const r = peak ?? BASE_Y - 70 * a
  return [
    `L${x0} ${BASE_Y}`,
    `Q${x0 + 10} ${BASE_Y - 12 * a} ${x0 + 20} ${BASE_Y}`,
    `L${x0 + 30} ${BASE_Y}`,
    `L${x0 + 35} ${BASE_Y + 10 * a}`,
    `L${x0 + 42} ${r}`,
    `L${x0 + 49} ${BASE_Y + 22 * a}`,
    `L${x0 + 54} ${BASE_Y}`,
    `L${x0 + 70} ${BASE_Y}`,
    `Q${x0 + 84} ${BASE_Y - 20 * a} ${x0 + 98} ${BASE_Y}`,
  ].join(" ")
}

export interface RiskStripProps {
  /** null while idle or pending. */
  probability: number | null
  status: "idle" | "pending" | "result"
  /** The band of the result being shown, which may predate a model change. */
  band?: { refer_low: number; refer_high: number }
  threshold?: number
  description?: string
}

export function RiskStrip({
  probability,
  status,
  band,
  threshold,
  description,
}: RiskStripProps) {
  const session = useSession()
  const [ref, measured] = useMeasure<HTMLDivElement>()
  const W = Math.max(300, measured || 1000)
  const narrow = W < 640

  const refer = band ?? session.band
  const thr = threshold ?? session.threshold
  const x = React.useCallback(
    (p: number) => Math.max(0, Math.min(1, p)) * W,
    [W]
  )

  const zones: [number, number, string, string, string][] = [
    [
      0,
      refer.refer_low,
      "var(--safe-tint)",
      "var(--safe)",
      narrow ? "No disease" : "No disease likely",
    ],
    [
      refer.refer_low,
      refer.refer_high,
      "var(--refer-tint)",
      "var(--refer)",
      narrow ? "Refer" : "Refer to clinician",
    ],
    [
      refer.refer_high,
      1,
      "var(--risk-tint)",
      "var(--risk)",
      narrow ? "Disease" : "Disease likely",
    ],
  ]

  // ECG-paper grid on the probability scale: a line every point, major every five.
  const step = narrow ? 2 : 1
  const verticals: { at: number; major: boolean }[] = []
  for (let i = 0; i <= 100; i += step) {
    verticals.push({
      at: i / 100,
      major: i % 10 === 0 || (!narrow && i % 5 === 0),
    })
  }
  const horizontals: { y: number; major: boolean }[] = []
  for (let y = 0; y <= 190; y += 10)
    horizontals.push({ y, major: y % 50 === 0 })

  const ticks: number[] = []
  for (let i = 0; i <= 10; i += narrow ? 2 : 1) ticks.push(i)

  const d = React.useMemo(() => {
    if (status === "idle") return `M0 ${BASE_Y} H${W}`
    if (status === "pending" || probability == null) {
      let path = `M0 ${BASE_Y}`
      for (let c = 8; c < W - 110; c += 125) path += " " + beat(c, 0.45)
      return path + ` L${W} ${BASE_Y}`
    }
    const mx = x(probability)
    let path = `M0 ${BASE_Y}`
    let cur = 8
    while (cur + 125 < mx - 60) {
      path += " " + beat(cur, 0.55)
      cur += 125
    }
    // The final beat's R peak lands exactly on the probability.
    const start = mx - 42
    path +=
      ` L${start} ${BASE_Y} ` +
      beat(start, 0.9, TOP_Y).replace(/^L[^L]*?(?=Q)/, "")
    return path + ` L${W} ${BASE_Y}`
  }, [status, probability, W, x])

  const showMarker = status === "result" && probability != null

  return (
    <div ref={ref} className="w-full">
      <svg
        viewBox={`0 0 ${W} 230`}
        role="img"
        aria-label={description ?? "Risk strip. No result yet."}
        className="block w-full"
      >
        <g aria-hidden="true">
          {verticals.map(({ at, major }) => (
            <line
              key={`v${at}`}
              x1={x(at)}
              x2={x(at)}
              y1={0}
              y2={192}
              stroke={major ? "var(--grid-major)" : "var(--grid-minor)"}
              strokeWidth={1}
              opacity={major ? 0.9 : 0.75}
            />
          ))}
          {horizontals.map(({ y, major }) => (
            <line
              key={`h${y}`}
              x1={0}
              x2={W}
              y1={y}
              y2={y}
              stroke={major ? "var(--grid-major)" : "var(--grid-minor)"}
              strokeWidth={1}
              opacity={major ? 0.9 : 0.75}
            />
          ))}
        </g>

        <g>
          {zones.map(([a, b, fill, ink, label]) => (
            <g key={label}>
              <rect
                x={x(a)}
                y={0}
                width={x(b) - x(a)}
                height={196}
                fill={fill}
                opacity={0.55}
              />
              <rect
                x={x(a)}
                y={192}
                width={x(b) - x(a)}
                height={4}
                fill={ink}
              />
              <text
                x={(x(a) + x(b)) / 2}
                y={22}
                textAnchor="middle"
                fill={ink}
                className="text-[13px] font-bold"
              >
                {label}
              </text>
            </g>
          ))}
          <line
            x1={x(thr)}
            x2={x(thr)}
            y1={40}
            y2={192}
            stroke="var(--muted-foreground)"
            strokeWidth={1}
            strokeDasharray="1 4"
          />
          <text
            x={x(thr) + 6}
            y={186}
            className="fill-muted-foreground text-[11px] font-medium"
          >
            {narrow
              ? `threshold ${pct(thr)}`
              : `decision threshold ${pct(thr)}`}
          </text>
        </g>

        <path
          key={`${status}-${probability ?? "none"}-${W}`}
          d={d}
          pathLength={1000}
          strokeDasharray={status === "result" ? 1000 : undefined}
          strokeDashoffset={status === "result" ? 1000 : undefined}
          className={
            status === "result"
              ? "ecg-trace is-drawing"
              : status === "pending"
                ? "ecg-trace is-pending"
                : "ecg-trace is-idle"
          }
        />

        {showMarker && (
          <g className="animate-in duration-500 fade-in">
            <line
              x1={x(probability)}
              x2={x(probability)}
              y1={TOP_Y}
              y2={196}
              stroke="var(--foreground)"
              strokeWidth={1.5}
              strokeDasharray="3 4"
            />
            <circle
              cx={x(probability)}
              cy={TOP_Y}
              r={6}
              fill="var(--foreground)"
            />
          </g>
        )}

        <g>
          {ticks.map((i) => (
            <text
              key={i}
              x={Math.min(W - 4, Math.max(4, x(i / 10)))}
              y={218}
              textAnchor={i === 0 ? "start" : i === 10 ? "end" : "middle"}
              className="fill-muted-foreground text-[11px] font-medium"
            >
              {i * 10}%
            </text>
          ))}
        </g>
      </svg>
    </div>
  )
}
