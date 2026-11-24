import { DownloadIcon } from "lucide-react"

import { AssessmentTable } from "@/components/assessment-table"
import { PageHead } from "@/components/page-head"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty"
import { useAsync } from "@/hooks/use-async"
import { api } from "@/lib/api"
import { plural } from "@/lib/format"
import { PageError, PageLoading } from "@/pages/page-state"

const TILES = [
  { key: "patients", href: "#patients", label: "Patients" },
  { key: "doctors", href: "#doctors", label: "Doctors" },
  { key: "assessments", href: "#assessments", label: "Assessments" },
] as const

export function OverviewPage() {
  const { data, error, loading, reload } = useAsync(() => api.stats(), [])

  if (loading && !data) return <PageLoading />
  if (error) return <PageError message={error} />
  if (!data) return null

  const mix = data.latest_decision_mix
  const total = Object.values(mix).reduce((a, b) => a + b, 0)

  const rows: [string, number, string][] = [
    ["Disease likely", mix["Disease likely"] ?? 0, "bg-risk"],
    ["Refer to clinician", mix["Refer"] ?? 0, "bg-refer-mark"],
    ["No disease likely", mix["No disease likely"] ?? 0, "bg-safe"],
  ]

  const counts: Record<string, { value: number; note: string }> = {
    patients: { value: data.patients, note: `${data.active_patients} active` },
    doctors: { value: data.doctors, note: "active accounts" },
    assessments: {
      value: data.assessments,
      note: `${data.assessments_30d} in the last 30 days`,
    },
  }

  return (
    <div className="view-enter stagger flex flex-col gap-6">
      <PageHead
        title="Overview"
        description="Everything in the SmartHeart database."
        actions={
          <Button
            variant="outline"
            render={<a href="/api/admin/export.csv" download />}
          >
            <DownloadIcon data-icon="inline-start" />
            Export all assessments
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {TILES.map((tile) => (
          <Card
            key={tile.key}
            className="lift relative transition-colors hover:border-primary/50"
          >
            <CardHeader>
              <CardDescription>{tile.label}</CardDescription>
              <CardTitle className="text-4xl">
                <a href={tile.href} className="after:absolute after:inset-0">
                  {counts[tile.key].value}
                </a>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                {counts[tile.key].note}
              </p>
            </CardContent>
          </Card>
        ))}
        <Card
          className={
            data.unassigned_patients
              ? "relative border-refer/50 bg-refer-tint transition-colors"
              : "relative transition-colors hover:border-primary/50"
          }
        >
          <CardHeader>
            <CardDescription>Patients without a doctor</CardDescription>
            <CardTitle className="text-4xl">
              <a href="#patients" className="after:absolute after:inset-0">
                {data.unassigned_patients}
              </a>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              {data.unassigned_patients
                ? "assign them from the patient page"
                : "everyone has a doctor"}
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle>Latest result per patient</CardTitle>
          </CardHeader>
          <CardContent>
            {total ? (
              <>
                <div className="flex flex-col gap-3">
                  {rows.map(([label, n, color]) => (
                    <div key={label} className="flex items-center gap-3">
                      <span className="w-36 shrink-0 text-sm">{label}</span>
                      <span className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                        <span
                          className={`block h-full rounded-full ${color}`}
                          style={{ width: `${total ? (n / total) * 100 : 0}%` }}
                        />
                      </span>
                      <b className="w-8 text-right text-sm">{n}</b>
                    </div>
                  ))}
                </div>
                <p className="mt-4 text-sm text-muted-foreground">
                  {plural(total, "patient")} with at least one assessment.
                </p>
              </>
            ) : (
              <p className="text-muted-foreground">No assessments yet.</p>
            )}
          </CardContent>
        </Card>

        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-bold">Recent assessments</h2>
          {data.recent.length ? (
            <AssessmentTable
              rows={data.recent}
              showPatient
              onChanged={reload}
            />
          ) : (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>No assessments yet</EmptyTitle>
                <EmptyDescription>
                  They appear here as patients and doctors record them.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </section>
      </div>
    </div>
  )
}
