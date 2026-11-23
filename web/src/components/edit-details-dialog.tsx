import * as React from "react"

import { ChoiceGroup } from "@/components/choice-group"
import { Alert, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldTitle,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { api, type DetailsBody } from "@/lib/api"
import { CHOICES } from "@/lib/constants"
import { notify } from "@/lib/notify"
import { useSession } from "@/lib/session"
import type { Role, User } from "@/lib/types"

/** Everything the three account kinds can hold, as the dialog's working copy. */
interface Person {
  id: number
  full_name: string
  email?: string | null
  phone?: string | null
  sex?: number
  date_of_birth?: string
  specialty?: string
  hospital?: string
  registration_no?: string | null
  bio?: string | null
}

const BLURB: Record<Role, string> = {
  patient:
    "Age and sex are taken from here when an assessment is started. Assessments already saved keep the values recorded with them.",
  doctor:
    "Patients see the name, specialty, hospital and description when they choose a doctor.",
  admin: "Your name as it appears in the application.",
}

/**
 * Edits one account. The server allows this for an administrator (anybody) or
 * for the signed-in person themselves, and `role` decides which fields show.
 */
export function EditDetailsDialog({
  person,
  role,
  open,
  onOpenChange,
  onSaved,
}: {
  person: Person | null
  role: Role
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved?: (saved: User) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        {/* Mounted only while open, so the fields always start from the saved record. */}
        {person ? (
          <DetailsForm
            person={person}
            role={role}
            onDone={() => onOpenChange(false)}
            onSaved={onSaved}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function DetailsForm({
  person,
  role,
  onDone,
  onSaved,
}: {
  person: Person
  role: Role
  onDone: () => void
  onSaved?: (saved: User) => void
}) {
  const { user, setUser } = useSession()
  const self = person.id === user?.id

  const [form, setForm] = React.useState<Person>(person)
  const [error, setError] = React.useState<string | null>(null)
  const [saving, setSaving] = React.useState(false)

  const set = <K extends keyof Person>(key: K, value: Person[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }))

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    const body: DetailsBody = {
      full_name: (form.full_name ?? "").trim(),
      email: (form.email ?? "").trim() || null,
      phone: (form.phone ?? "").trim() || null,
    }
    if ((body.full_name ?? "").length < 2)
      return setError("Enter the full name.")

    if (role === "patient") {
      if (!form.date_of_birth) return setError("Enter the date of birth.")
      if (form.sex !== 0 && form.sex !== 1)
        return setError("Choose male or female.")
      body.date_of_birth = form.date_of_birth
      body.sex = form.sex
    } else if (role === "doctor") {
      body.specialty = (form.specialty ?? "").trim()
      body.hospital = (form.hospital ?? "").trim()
      body.registration_no = (form.registration_no ?? "").trim() || null
      body.bio = (form.bio ?? "").trim() || null
      if (!body.specialty || !body.hospital)
        return setError("Specialty and hospital are required.")
    }

    setSaving(true)
    try {
      const saved = await api.updateDetails(form.id, body)
      if (self && user) setUser({ ...user, ...saved })
      onDone()
      notify(
        self
          ? "Your details were saved"
          : `Details saved for ${saved.full_name}`
      )
      onSaved?.(saved)
    } catch (ex) {
      setError((ex as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5">
      <DialogHeader>
        <DialogTitle>
          {self ? "My details" : `Edit ${person.full_name}`}
        </DialogTitle>
        <DialogDescription>{BLURB[role]}</DialogDescription>
      </DialogHeader>

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>{error}</AlertTitle>
        </Alert>
      ) : null}

      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="ed-name">Full name</FieldLabel>
          <Input
            id="ed-name"
            maxLength={80}
            autoComplete="name"
            value={form.full_name ?? ""}
            onChange={(e) => set("full_name", e.target.value)}
          />
        </Field>

        {role === "patient" ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="ed-dob">Date of birth</FieldLabel>
              <Input
                id="ed-dob"
                type="date"
                value={form.date_of_birth ?? ""}
                onChange={(e) => set("date_of_birth", e.target.value)}
              />
            </Field>
            <Field>
              <FieldTitle id="ed-sex-label">Sex</FieldTitle>
              <ChoiceGroup
                ariaLabelledBy="ed-sex-label"
                choices={CHOICES.sex}
                value={form.sex ?? null}
                onChange={(v) => set("sex", v)}
              />
            </Field>
          </div>
        ) : null}

        {role === "doctor" ? (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="ed-spec">Specialty</FieldLabel>
                <Input
                  id="ed-spec"
                  maxLength={80}
                  value={form.specialty ?? ""}
                  onChange={(e) => set("specialty", e.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="ed-hosp">Hospital</FieldLabel>
                <Input
                  id="ed-hosp"
                  maxLength={120}
                  value={form.hospital ?? ""}
                  onChange={(e) => set("hospital", e.target.value)}
                />
              </Field>
            </div>
            <Field>
              <FieldLabel htmlFor="ed-reg">
                Registration number{" "}
                <span className="text-muted-foreground">(optional)</span>
              </FieldLabel>
              <Input
                id="ed-reg"
                maxLength={40}
                value={form.registration_no ?? ""}
                onChange={(e) => set("registration_no", e.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="ed-bio">
                About{" "}
                <span className="text-muted-foreground">
                  (optional, shown to patients)
                </span>
              </FieldLabel>
              <Textarea
                id="ed-bio"
                rows={3}
                maxLength={600}
                value={form.bio ?? ""}
                onChange={(e) => set("bio", e.target.value)}
              />
            </Field>
          </>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="ed-email">
              Email <span className="text-muted-foreground">(optional)</span>
            </FieldLabel>
            <Input
              id="ed-email"
              type="email"
              maxLength={120}
              autoComplete="email"
              value={form.email ?? ""}
              onChange={(e) => set("email", e.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="ed-phone">
              Phone <span className="text-muted-foreground">(optional)</span>
            </FieldLabel>
            <Input
              id="ed-phone"
              type="tel"
              maxLength={30}
              autoComplete="tel"
              value={form.phone ?? ""}
              onChange={(e) => set("phone", e.target.value)}
            />
          </Field>
        </div>
      </FieldGroup>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={saving}>
          {saving ? <Spinner data-icon="inline-start" /> : null}
          Save changes
        </Button>
      </DialogFooter>
    </form>
  )
}
