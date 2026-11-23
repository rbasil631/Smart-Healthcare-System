import { cn } from "cn"

import { Badge } from "@/components/ui/badge"
import { shortDecision, verdictKind, type VerdictKind } from "@/lib/format"

const TONE: Record<VerdictKind, string> = {
  risk: "bg-risk-tint text-risk",
  refer: "bg-refer-tint text-refer",
  safe: "bg-safe-tint text-safe",
}

const DOT: Record<VerdictKind, string> = {
  risk: "bg-risk",
  refer: "bg-refer-mark",
  safe: "bg-safe",
}

/** The verdict reads as one of three outcomes, so it keeps its own colour everywhere. */
export function DecisionBadge({
  decision,
  className,
}: {
  decision: string
  className?: string
}) {
  const kind = verdictKind(decision)
  return (
    <Badge
      variant="outline"
      className={cn("border-transparent", TONE[kind], className)}
    >
      <span
        className={cn("size-1.5 rounded-full", DOT[kind])}
        aria-hidden="true"
      />
      {shortDecision(decision)}
    </Badge>
  )
}
