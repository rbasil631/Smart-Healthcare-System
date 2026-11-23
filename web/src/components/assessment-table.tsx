import { ArrowDownIcon, ArrowUpIcon } from "lucide-react"

import { DecisionBadge } from "@/components/decision-badge"
import { PositionBar } from "@/components/position-bar"
import { useConfirm } from "@/components/confirm-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { api } from "@/lib/api"
import { fmtDate, fmtTime, pct, roleWord } from "@/lib/format"
import { notify, notifyError } from "@/lib/notify"
import type { Assessment } from "@/lib/types"

function Delta({ value }: { value: number | undefined }) {
  if (value === undefined)
    return <span className="text-sm text-muted-foreground">First</span>
  if (Math.abs(value) < 0.005)
    return <span className="text-sm text-muted-foreground">No change</span>
  const up = value > 0
  return (
    <span
      className={`inline-flex items-center gap-1 text-sm font-semibold ${up ? "text-risk" : "text-safe"}`}
    >
      {up ? (
        <ArrowUpIcon className="size-3.5" />
      ) : (
        <ArrowDownIcon className="size-3.5" />
      )}
      {Math.abs(value * 100).toFixed(1)} pts
    </span>
  )
}

export function AssessmentTable({
  rows,
  showPatient = false,
  /** Chronological list used to work out the change from the previous visit. */
  deltas,
  canDelete = false,
  onChanged,
}: {
  rows: Assessment[]
  showPatient?: boolean
  deltas?: Assessment[]
  canDelete?: boolean
  onChanged?: () => void
}) {
  const confirm = useConfirm()

  const prev: Record<number, number> = {}
  deltas?.forEach((a, i) => {
    if (i > 0) prev[a.id] = a.probability - deltas[i - 1].probability
  })

  const onDelete = async (a: Assessment) => {
    const ok = await confirm({
      title: "Delete this assessment?",
      text: "It is removed from the history for everyone. This cannot be undone.",
      okLabel: "Delete",
      danger: true,
    })
    if (!ok) return
    try {
      await api.deleteAssessment(a.id)
      notify("Assessment deleted")
      onChanged?.()
    } catch (ex) {
      notifyError((ex as Error).message)
    }
  }

  return (
    <div className="overflow-x-auto rounded-xl border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Date</TableHead>
            {showPatient ? <TableHead>Patient</TableHead> : null}
            <TableHead className="text-right">Probability</TableHead>
            <TableHead className="hidden lg:table-cell">Position</TableHead>
            {deltas ? (
              <TableHead className="hidden lg:table-cell">Change</TableHead>
            ) : null}
            <TableHead>Decision</TableHead>
            <TableHead className="hidden lg:table-cell">Entered by</TableHead>
            <TableHead className="hidden xl:table-cell">Notes</TableHead>
            <TableHead>
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((a) => (
            <TableRow key={a.id}>
              <TableCell className="whitespace-nowrap">
                {fmtDate(a.created_at)}
                <br />
                <small className="text-muted-foreground">
                  {fmtTime(a.created_at)}
                </small>
              </TableCell>
              {showPatient ? (
                <TableCell>
                  <a
                    href={`#patient/${a.patient_id}`}
                    className="font-semibold hover:underline"
                  >
                    {a.patient_name}
                  </a>
                </TableCell>
              ) : null}
              <TableCell className="text-right font-semibold">
                {pct(a.probability)}
              </TableCell>
              <TableCell className="hidden lg:table-cell">
                <PositionBar probability={a.probability} />
              </TableCell>
              {deltas ? (
                <TableCell className="hidden lg:table-cell">
                  <Delta value={prev[a.id]} />
                </TableCell>
              ) : null}
              <TableCell>
                <DecisionBadge decision={a.decision} />
              </TableCell>
              <TableCell className="hidden lg:table-cell">
                {a.created_by_name}
                {a.created_by_role !== "patient" ? (
                  <>
                    <br />
                    <small className="text-muted-foreground">
                      {roleWord(a.created_by_role)}
                    </small>
                  </>
                ) : null}
              </TableCell>
              <TableCell className="hidden max-w-56 xl:table-cell">
                <span className="block truncate" title={a.notes ?? ""}>
                  {a.notes}
                </span>
              </TableCell>
              <TableCell>
                <div className="flex justify-end gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    render={<a href={`#assessment/${a.id}`} />}
                  >
                    Open
                  </Button>
                  {canDelete ? (
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => void onDelete(a)}
                      aria-label={`Delete assessment of ${fmtDate(a.created_at)}`}
                    >
                      Delete
                    </Button>
                  ) : null}
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {rows.length === 0 ? (
        <p className="px-4 py-8 text-center text-muted-foreground">
          <Badge variant="secondary">Nothing to show</Badge>
        </p>
      ) : null}
    </div>
  )
}
