import { useMeasure } from "@/hooks/use-measure"
import { pct, pts } from "@/lib/format"
import type { Contribution, Explanation } from "@/lib/types"

/**
 * One row per input, each bar showing how far it moved the probability from the
 * average training patient to this one. Red raises the risk, green lowers it.
 */
export function ShapWaterfall({
  explanation,
  probability,
}: {
  explanation: Explanation
  probability: number
}) {
  const [ref, measured] = useMeasure<HTMLDivElement>()
  const width = Math.max(280, measured || 600)
  const narrow = width < 560

  const items = explanation.contributions
  const rowH = narrow ? 50 : 34
  const top = narrow ? 10 : 30
  const right = narrow ? 64 : 70
  const left = narrow ? 8 : Math.min(300, Math.round(width * 0.38))
  const barY = narrow ? 20 : 3 // on a narrow screen the label sits above the bar
  const height = top + rowH * (items.length + 2) + 26

  const steps: (Contribution & { from: number; to: number })[] = []
  let cum = explanation.base_value
  for (const c of items) {
    steps.push({ ...c, from: cum, to: cum + c.shap })
    cum += c.shap
  }

  const all = [
    explanation.base_value,
    probability,
    ...steps.flatMap((s) => [s.from, s.to]),
  ]
  let lo = Math.min(...all)
  let hi = Math.max(...all)
  const pad = Math.max(0.04, (hi - lo) * 0.08)
  lo = Math.max(0, lo - pad)
  hi = Math.min(1, hi + pad)
  const sx = (v: number) =>
    left + ((v - lo) / (hi - lo)) * (width - left - right)

  const gridTicks: number[] = []
  for (let t = Math.ceil(lo * 10) / 10; t <= hi + 1e-9; t += 0.1)
    gridTicks.push(t)

  const refRow = (index: number, value: number, label: string) => {
    const y = top + index * rowH
    return (
      <g key={label}>
        <line
          x1={sx(value)}
          x2={sx(value)}
          y1={y + barY - 4}
          y2={y + rowH - 10}
          stroke="var(--foreground)"
          strokeWidth={2}
        />
        {narrow ? (
          <text x={0} y={y + 12} className="fill-foreground text-xs font-bold">
            {label}
          </text>
        ) : (
          <text
            x={left - 14}
            y={y + 16}
            textAnchor="end"
            className="fill-foreground text-xs font-bold"
          >
            {label}
          </text>
        )}
        <text
          x={sx(value) + 8}
          y={y + barY + 13}
          className="fill-foreground text-[11px] font-semibold"
        >
          {pct(value, 1)}
        </text>
      </g>
    )
  }

  return (
    <div ref={ref} className="w-full">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="SHAP contribution of each input"
        className="block w-full"
      >
        {gridTicks.map((t) => (
          <g key={t}>
            <line
              x1={sx(t)}
              x2={sx(t)}
              y1={top - 8}
              y2={height - 22}
              stroke="var(--border)"
              strokeWidth={1}
            />
            <text
              x={sx(t)}
              y={height - 6}
              textAnchor="middle"
              className="fill-muted-foreground text-[11px]"
            >
              {Math.round(t * 100)}%
            </text>
          </g>
        ))}

        {refRow(0, explanation.base_value, "Average patient")}

        {steps.map((s, i) => {
          const y = top + (i + 1) * rowH
          const up = s.shap >= 0
          const color = up ? "var(--risk)" : "var(--safe)"
          const a = sx(Math.min(s.from, s.to))
          const b = sx(Math.max(s.from, s.to))
          const bh = narrow ? rowH - 30 : rowH - 14
          return (
            <g key={s.feature ?? s.label}>
              {narrow ? (
                <text
                  x={0}
                  y={y + 12}
                  className="fill-foreground text-xs font-semibold"
                >
                  {s.label}:{" "}
                  <tspan className="fill-muted-foreground font-normal">
                    {s.display}
                  </tspan>
                </text>
              ) : (
                <>
                  <text
                    x={0}
                    y={y + 11}
                    className="fill-foreground text-xs font-semibold"
                  >
                    {s.label}
                  </text>
                  <text
                    x={0}
                    y={y + 25}
                    className="fill-muted-foreground text-[11px]"
                  >
                    {s.display}
                  </text>
                </>
              )}
              <line
                x1={sx(s.from)}
                x2={sx(s.from)}
                y1={y - rowH + barY}
                y2={y + barY + bh}
                stroke="var(--muted-foreground)"
                strokeWidth={1}
                strokeDasharray="2 3"
              />
              <rect
                x={a}
                y={y + barY}
                width={Math.max(2, b - a)}
                height={bh}
                rx={3}
                fill={color}
                opacity={0.88}
              />
              <text
                x={up ? b + 6 : a - 6}
                y={y + barY + 13}
                textAnchor={up ? "start" : "end"}
                fill={color}
                className="text-[11px] font-semibold"
              >
                {pts(s.shap)}
              </text>
            </g>
          )
        })}

        {refRow(items.length + 1, probability, "This patient")}
      </svg>
    </div>
  )
}
