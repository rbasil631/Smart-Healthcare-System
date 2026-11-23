import * as React from "react"
import { PlusIcon } from "lucide-react"

import { useConfirm } from "@/components/confirm-dialog"
import { EditDetailsDialog } from "@/components/edit-details-dialog"
import { PageHead } from "@/components/page-head"
import { Alert, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { useAsync } from "@/hooks/use-async"
import { api } from "@/lib/api"
import { USERNAME_RE } from "@/lib/constants"
import { plural } from "@/lib/format"
import { notify, notifyError } from "@/lib/notify"
import type { Doctor } from "@/lib/types"
import { PageError, PageLoading } from "@/pages/page-state"

export function DoctorsAdminPage() {
  const confirm = useConfirm()
  const [adding, setAdding] = React.useState(false)
  const [editing, setEditing] = React.useState<Doctor | null>(null)
  const { data, error, loading, reload } = useAsync(() => api.doctors(), [])

  if (loading && !data) return <PageLoading />
  if (error) return <PageError message={error} />
  if (!data) return null

  const resetPassword = async (doctor: Doctor) => {
    const password = await confirm({
      title: `Reset password for ${doctor.full_name}`,
      text: "They will be signed out everywhere and must use the new password.",
      okLabel: "Reset password",
      passwordLabel: "New password",
    })
    if (typeof password !== "string") return
    try {
      await api.resetPassword(doctor.id, password)
      notify(`Password reset for ${doctor.full_name}`)
    } catch (ex) {
      notifyError((ex as Error).message)
    }
  }

  const toggleActive = async (doctor: Doctor) => {
    const ok = await confirm(
      doctor.is_active
        ? {
            title: `Deactivate ${doctor.full_name}?`,
            text: "They can no longer sign in. Their data is kept and you can reactivate them later.",
            okLabel: "Deactivate",
            danger: true,
          }
        : {
            title: `Reactivate ${doctor.full_name}?`,
            text: "They will be able to sign in again.",
            okLabel: "Reactivate",
          }
    )
    if (!ok) return
    try {
      await api.setActive(doctor.id, !doctor.is_active)
      notify(
        doctor.is_active
          ? `${doctor.full_name} deactivated`
          : `${doctor.full_name} reactivated`
      )
      reload()
    } catch (ex) {
      notifyError((ex as Error).message)
    }
  }

  return (
    <div className="view-enter flex flex-col gap-6">
      <PageHead
        title="Doctors"
        description={`${plural(
          data.filter((d) => d.is_active).length,
          "active doctor"
        )}. Patients choose from this list; you can also assign them from a patient's page.`}
        actions={
          <Button onClick={() => setAdding((v) => !v)}>
            <PlusIcon data-icon="inline-start" />
            Add doctor
          </Button>
        }
      />

      {adding ? (
        <NewDoctorForm
          onCancel={() => setAdding(false)}
          onCreated={() => {
            setAdding(false)
            reload()
          }}
        />
      ) : null}

      <div className="overflow-x-auto rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Doctor</TableHead>
              <TableHead>Specialty</TableHead>
              <TableHead className="hidden lg:table-cell">Hospital</TableHead>
              <TableHead className="text-right">Patients</TableHead>
              <TableHead className="hidden lg:table-cell">Status</TableHead>
              <TableHead>
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((d) => (
              <TableRow key={d.id}>
                <TableCell>
                  <b>{d.full_name}</b>
                  <br />
                  <small className="text-muted-foreground">
                    {d.username}
                    {d.registration_no ? `, ${d.registration_no}` : ""}
                  </small>
                </TableCell>
                <TableCell>{d.specialty}</TableCell>
                <TableCell className="hidden lg:table-cell">
                  {d.hospital}
                </TableCell>
                <TableCell className="text-right font-semibold">
                  {d.n_patients}
                </TableCell>
                <TableCell className="hidden lg:table-cell">
                  <Badge variant={d.is_active ? "secondary" : "destructive"}>
                    {d.is_active ? "Active" : "Deactivated"}
                  </Badge>
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap justify-end gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setEditing(d)}
                    >
                      Edit details
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void resetPassword(d)}
                    >
                      Reset password
                    </Button>
                    <Button
                      variant={d.is_active ? "destructive" : "outline"}
                      size="sm"
                      onClick={() => void toggleActive(d)}
                    >
                      {d.is_active ? "Deactivate" : "Reactivate"}
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <EditDetailsDialog
        person={editing}
        role="doctor"
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null)
        }}
        onSaved={reload}
      />
    </div>
  )
}

const BLANK = {
  full_name: "",
  specialty: "",
  hospital: "",
  username: "",
  password: "",
  registration_no: "",
  email: "",
  phone: "",
}

function NewDoctorForm({
  onCancel,
  onCreated,
}: {
  onCancel: () => void
  onCreated: () => void
}) {
  const [form, setForm] = React.useState(BLANK)
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)

  const set = (key: keyof typeof BLANK, value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }))

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)
    const body = {
      full_name: form.full_name.trim(),
      specialty: form.specialty.trim(),
      hospital: form.hospital.trim(),
      username: form.username.trim(),
      password: form.password,
      registration_no: form.registration_no.trim() || null,
      email: form.email.trim() || null,
      phone: form.phone.trim() || null,
    }
    if (!body.full_name || !body.specialty || !body.hospital)
      return setError("Name, specialty and hospital are required.")
    if (!USERNAME_RE.test(body.username))
      return setError(
        "Username: 3 to 40 letters, digits, dots, dashes or underscores."
      )
    if (body.password.length < 8)
      return setError("The initial password needs at least 8 characters.")

    setBusy(true)
    try {
      await api.createDoctor(body)
      notify(`${body.full_name} can now sign in as ${body.username}`)
      onCreated()
    } catch (ex) {
      setError((ex as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>New doctor account</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="flex flex-col gap-5">
          {error ? (
            <Alert variant="destructive">
              <AlertTitle>{error}</AlertTitle>
            </Alert>
          ) : null}

          <FieldGroup className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Field>
              <FieldLabel htmlFor="nd-name">Full name</FieldLabel>
              <Input
                id="nd-name"
                maxLength={80}
                placeholder="Dr. …"
                value={form.full_name}
                onChange={(e) => set("full_name", e.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="nd-spec">Specialty</FieldLabel>
              <Input
                id="nd-spec"
                maxLength={80}
                placeholder="Clinical Cardiology"
                value={form.specialty}
                onChange={(e) => set("specialty", e.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="nd-hosp">Hospital</FieldLabel>
              <Input
                id="nd-hosp"
                maxLength={120}
                value={form.hospital}
                onChange={(e) => set("hospital", e.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="nd-user">Username</FieldLabel>
              <Input
                id="nd-user"
                maxLength={40}
                autoComplete="off"
                value={form.username}
                onChange={(e) => set("username", e.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="nd-pass">Initial password</FieldLabel>
              <Input
                id="nd-pass"
                type="password"
                autoComplete="new-password"
                value={form.password}
                onChange={(e) => set("password", e.target.value)}
              />
              <FieldDescription>
                At least 8 characters; share it with the doctor
              </FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="nd-reg">
                Registration number{" "}
                <span className="text-muted-foreground">(optional)</span>
              </FieldLabel>
              <Input
                id="nd-reg"
                maxLength={40}
                value={form.registration_no}
                onChange={(e) => set("registration_no", e.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="nd-email">
                Email <span className="text-muted-foreground">(optional)</span>
              </FieldLabel>
              <Input
                id="nd-email"
                type="email"
                maxLength={120}
                value={form.email}
                onChange={(e) => set("email", e.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="nd-phone">
                Phone <span className="text-muted-foreground">(optional)</span>
              </FieldLabel>
              <Input
                id="nd-phone"
                type="tel"
                maxLength={30}
                value={form.phone}
                onChange={(e) => set("phone", e.target.value)}
              />
            </Field>
          </FieldGroup>

          <div className="flex gap-2">
            <Button type="submit" disabled={busy}>
              {busy ? <Spinner data-icon="inline-start" /> : null}
              Create doctor
            </Button>
            <Button type="button" variant="outline" onClick={onCancel}>
              Cancel
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
