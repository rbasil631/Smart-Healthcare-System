import * as React from "react"
import { DownloadIcon, XIcon } from "lucide-react"

import { AssessmentTable } from "@/components/assessment-table"
import { useConfirm } from "@/components/confirm-dialog"
import { EditDetailsDialog } from "@/components/edit-details-dialog"
import { PageHead } from "@/components/page-head"
import { TrendChart } from "@/components/trend-chart"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { api } from "@/lib/api"
import { fmtDate, pct, plural, sexWord, shortDecision } from "@/lib/format"
import { notify, notifyError } from "@/lib/notify"
import { useSession } from "@/lib/session"
import type { Assessment, Doctor, PatientDetail } from "@/lib/types"
import { useAsync } from "@/hooks/use-async"
import { go } from "@/hooks/use-hash-route"
import { PageError, PageLoading } from "@/pages/page-state"

export function PatientPage({ pid }: { pid: number }) {
  const { user } = useSession()
  const confirm = useConfirm()
  const [editOpen, setEditOpen] = React.useState(false)

  const { data, error, loading, reload } = useAsync(
    () => Promise.all([api.patient(pid), api.patientAssessments(pid)]),
    [pid]
  )

  if (loading && !data) return <PageLoading />
  if (error) return <PageError message={error} />
  if (!data || !user) return null

  const [patient, list] = data as [PatientDetail, Assessment[]]
  const self = user.role === "patient"
  const admin = user.role === "admin"
  const canEdit = admin || self
  const newHref = self ? "#assess" : `#assess/${patient.id}`
  const last = list[list.length - 1]

  const onResetPassword = async () => {
    const password = await confirm({
      title: `Reset password for ${patient.full_name}`,
      text: "They will be signed out everywhere and must use the new password.",
      okLabel: "Reset password",
      passwordLabel: "New password",
    })
    if (typeof password !== "string") return
    try {
      await api.resetPassword(patient.id, password)
      notify(`Password reset for ${patient.full_name}`)
    } catch (ex) {
      notifyError((ex as Error).message)
    }
  }

  const onToggleActive = async () => {
    const ok = await confirm(
      patient.is_active
        ? {
            title: `Deactivate ${patient.full_name}?`,
            text: "They can no longer sign in. Their data is kept and you can reactivate them later.",
            okLabel: "Deactivate",
            danger: true,
          }
        : {
            title: `Reactivate ${patient.full_name}?`,
            text: "They will be able to sign in again.",
            okLabel: "Reactivate",
          }
    )
    if (!ok) return
    try {
      await api.setActive(patient.id, !patient.is_active)
      notify(
        patient.is_active
          ? `${patient.full_name} deactivated`
          : `${patient.full_name} reactivated`
      )
      reload()
    } catch (ex) {
      notifyError((ex as Error).message)
    }
  }

  return (
    <div className="view-enter flex flex-col gap-6">
      <PageHead
        title={self ? "My history" : patient.full_name}
        description={`${patient.full_name}, ${patient.age} years, ${sexWord(patient.sex)}. ${
          list.length
            ? `${plural(list.length, "assessment")} since ${fmtDate(list[0].created_at)}.`
            : "No assessments yet."
        }`}
        back={
          self
            ? undefined
            : {
                href: "#patients",
                label: admin ? "All patients" : "My patients",
              }
        }
        actions={
          <>
            {list.length ? (
              <Button
                variant="outline"
                render={
                  <a href={`/api/patients/${patient.id}/export.csv`} download />
                }
              >
                <DownloadIcon data-icon="inline-start" />
                Export CSV
              </Button>
            ) : null}
            {patient.is_active ? (
              <Button render={<a href={newHref} />}>New assessment</Button>
            ) : null}
          </>
        }
      />

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Card>
          <CardHeader>
            <CardTitle>Risk over time</CardTitle>
          </CardHeader>
          <CardContent>
            {list.length ? (
              <>
                <p className="mb-3 text-sm text-muted-foreground">
                  Each point is one assessment. Latest:{" "}
                  <b>{pct(last.probability)}</b>,{" "}
                  {shortDecision(last.decision).toLowerCase()}, on{" "}
                  {fmtDate(last.created_at)}. Select a point to open it.
                </p>
                <TrendChart
                  list={list}
                  onOpen={(id) => go(`assessment/${id}`)}
                />
              </>
            ) : (
              <Empty>
                <EmptyHeader>
                  <EmptyTitle>No assessments yet</EmptyTitle>
                  <EmptyDescription>
                    {self
                      ? "Run your first assessment. Every later one is added here with its date, so you can see how your risk changes."
                      : "Run the first assessment for this patient."}
                  </EmptyDescription>
                </EmptyHeader>
                {patient.is_active ? (
                  <EmptyContent>
                    <Button render={<a href={newHref} />}>
                      Start the first assessment
                    </Button>
                  </EmptyContent>
                ) : null}
              </Empty>
            )}
          </CardContent>
        </Card>

        <ProfileCard
          patient={patient}
          admin={admin}
          self={self}
          canEdit={canEdit}
          onEdit={() => setEditOpen(true)}
          onReload={reload}
          onResetPassword={onResetPassword}
          onToggleActive={onToggleActive}
        />
      </div>

      {list.length ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-bold">All assessments</h2>
          <AssessmentTable
            rows={[...list].reverse()}
            deltas={list}
            canDelete={admin || self}
            onChanged={reload}
          />
        </section>
      ) : null}

      <EditDetailsDialog
        person={patient}
        role="patient"
        open={editOpen}
        onOpenChange={setEditOpen}
        onSaved={reload}
      />
    </div>
  )
}

function ProfileCard({
  patient,
  admin,
  self,
  canEdit,
  onEdit,
  onReload,
  onResetPassword,
  onToggleActive,
}: {
  patient: PatientDetail
  admin: boolean
  self: boolean
  canEdit: boolean
  onEdit: () => void
  onReload: () => void
  onResetPassword: () => void
  onToggleActive: () => void
}) {
  const [all, setAll] = React.useState<Doctor[]>([])
  const [picked, setPicked] = React.useState<string>("")

  React.useEffect(() => {
    if (!admin) return
    let alive = true
    api
      .doctors()
      .then((list) => {
        if (alive) setAll(list)
      })
      .catch(() => {
        /* the assign control simply stays empty */
      })
    return () => {
      alive = false
    }
  }, [admin])

  const have = new Set(patient.doctors.map((d) => d.id))
  const assignable = all.filter((d) => d.is_active && !have.has(d.id))

  const assign = async () => {
    if (!picked) return
    try {
      await api.assign(patient.id, Number(picked))
      notify("Doctor assigned")
      setPicked("")
      onReload()
    } catch (ex) {
      notifyError((ex as Error).message)
    }
  }

  const unassign = async (doctorId: number) => {
    try {
      await api.unassign(patient.id, doctorId)
      notify("Doctor removed")
      onReload()
    } catch (ex) {
      notifyError((ex as Error).message)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Profile</CardTitle>
        {canEdit ? (
          <Button
            variant="outline"
            size="sm"
            onClick={onEdit}
            className="ml-auto"
          >
            Edit details
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          <dt className="text-muted-foreground">Username</dt>
          <dd className="font-medium">{patient.username}</dd>
          <dt className="text-muted-foreground">Date of birth</dt>
          <dd className="font-medium">{fmtDate(patient.date_of_birth)}</dd>
          {patient.email ? (
            <>
              <dt className="text-muted-foreground">Email</dt>
              <dd className="font-medium break-all">{patient.email}</dd>
            </>
          ) : null}
          {patient.phone ? (
            <>
              <dt className="text-muted-foreground">Phone</dt>
              <dd className="font-medium">{patient.phone}</dd>
            </>
          ) : null}
          <dt className="text-muted-foreground">Registered</dt>
          <dd className="font-medium">{fmtDate(patient.created_at)}</dd>
          {admin ? (
            <>
              <dt className="text-muted-foreground">Status</dt>
              <dd>
                <Badge
                  variant={patient.is_active ? "secondary" : "destructive"}
                >
                  {patient.is_active ? "Active" : "Deactivated"}
                </Badge>
              </dd>
            </>
          ) : null}
        </dl>

        <Separator />

        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-bold">
            {self ? "My doctors" : "Doctors"}
          </h3>
          {patient.doctors.length ? (
            <div className="flex flex-wrap gap-2">
              {patient.doctors.map((d) => (
                <Badge
                  key={d.id}
                  variant="secondary"
                  className="h-7 gap-1 pr-1"
                >
                  {d.full_name}
                  {admin ? (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Remove ${d.full_name}`}
                      onClick={() => void unassign(d.id)}
                    >
                      <XIcon />
                    </Button>
                  ) : null}
                </Badge>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              {self
                ? "You have not chosen a doctor yet."
                : "No doctor assigned."}
            </p>
          )}
          {self ? (
            <a
              href="#doctors"
              className="text-sm font-semibold underline underline-offset-4"
            >
              Choose doctors
            </a>
          ) : null}
        </div>

        {admin ? (
          <>
            <div className="flex gap-2">
              <Select value={picked} onValueChange={(v) => setPicked(v ?? "")}>
                <SelectTrigger className="flex-1" aria-label="Doctor to assign">
                  <SelectValue placeholder="Assign a doctor" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {assignable.map((d) => (
                      <SelectItem key={d.id} value={String(d.id)}>
                        {d.full_name}, {d.specialty}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                onClick={() => void assign()}
                disabled={!picked}
              >
                Assign
              </Button>
            </div>

            <Separator />

            <div className="flex flex-col gap-2">
              <h3 className="text-sm font-bold">Account</h3>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={onResetPassword}>
                  Reset password
                </Button>
                <Button
                  variant={patient.is_active ? "destructive" : "outline"}
                  size="sm"
                  onClick={onToggleActive}
                >
                  {patient.is_active ? "Deactivate" : "Reactivate"}
                </Button>
              </div>
            </div>
          </>
        ) : null}
      </CardContent>
    </Card>
  )
}
