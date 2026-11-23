import * as React from "react"

import { ChoiceGroup } from "@/components/choice-group"
import { PageHead } from "@/components/page-head"
import { RiskStrip } from "@/components/risk-strip"
import { ShapWaterfall } from "@/components/shap-waterfall"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
  FieldTitle,
} from "@/components/ui/field"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@/components/ui/input-group"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { api, type AssessmentBody } from "@/lib/api"
import {
  CHOICES,
  EXAMPLES,
  LIMITS,
  NUMERIC,
  RADIOS,
  UNITS,
} from "@/lib/constants"
import type { NumericKey, RadioKey } from "@/lib/constants"
import { fmtDate, fmtTime, pct, sexWord, verdictKind } from "@/lib/format"
import { notify, notifyError } from "@/lib/notify"
import { useSession } from "@/lib/session"
import type { Assessment, Inputs, PatientDetail, Result } from "@/lib/types"

interface FormState extends Record<NumericKey, string> {
  cholMissing: boolean
  sex: number | null
  chest_pain_type: number | null
  fasting_blood_sugar: number | null
  resting_ecg: number | null
  exercise_angina: number | null
  ST_slope: number | null
  notes: string
}

const EMPTY: FormState = {
  age: "",
  resting_bp_s: "",
  cholesterol: "",
  max_heart_rate: "",
  oldpeak: "",
  cholMissing: false,
  sex: null,
  chest_pain_type: null,
  fasting_blood_sugar: null,
  resting_ecg: null,
  exercise_angina: null,
  ST_slope: null,
  notes: "",
}

/** Only the keys present are changed, so a profile can pre-fill age and sex alone. */
function withValues(state: FormState, values: Partial<Inputs>): FormState {
  const next = { ...state }
  for (const key of NUMERIC) {
    if (!(key in values)) continue
    if (key === "cholesterol") {
      const missing =
        values.cholesterol == null || Number(values.cholesterol) === 0
      next.cholMissing = missing
      next.cholesterol = missing ? "" : String(values.cholesterol)
    } else {
      next[key] = values[key] == null ? "" : String(values[key])
    }
  }
  for (const key of RADIOS) {
    if (key in values) next[key] = Number(values[key])
  }
  return next
}

export function AssessPage({
  pid: pidProp,
  aid,
}: {
  pid?: number
  aid?: number
}) {
  const { user } = useSession()
  const self = user?.role === "patient"

  const [patient, setPatient] = React.useState<PatientDetail | null>(null)
  const [saved, setSaved] = React.useState<Assessment | null>(null)
  const [lastInputs, setLastInputs] = React.useState<Inputs | null>(null)
  const [visitCount, setVisitCount] = React.useState(0)
  const [loadError, setLoadError] = React.useState<string | null>(null)

  const [form, setForm] = React.useState<FormState>(EMPTY)
  const [errors, setErrors] = React.useState<Partial<Record<string, string>>>(
    {}
  )
  const [result, setResult] = React.useState<Result | null>(null)
  const [status, setStatus] = React.useState<"idle" | "pending" | "result">(
    "idle"
  )
  const [savedNote, setSavedNote] = React.useState<React.ReactNode>(null)

  const readoutRef = React.useRef<HTMLDivElement>(null)

  // The router keys this page by view and argument, so a different patient or
  // assessment arrives as a fresh mount and no state has to be reset here.
  React.useEffect(() => {
    let alive = true

    const load = async () => {
      let detail: Assessment | null = null
      let pid = pidProp
      if (aid) {
        detail = await api.assessment(aid)
        pid = detail.patient_id
      }
      if (!pid) throw new Error("No patient was given for this assessment.")
      const [p, list] = await Promise.all([
        api.patient(pid),
        api.patientAssessments(pid),
      ])
      if (!alive) return
      setPatient(p)
      setVisitCount(list.length)
      setLastInputs(list.length ? list[list.length - 1].inputs : null)
      if (detail) {
        setSaved(detail)
        setForm(
          withValues({ ...EMPTY, notes: detail.notes ?? "" }, detail.inputs)
        )
        if (detail.result) {
          setResult(detail.result)
          setStatus("result")
        }
      } else {
        setForm(withValues(EMPTY, { age: p.age, sex: p.sex }))
      }
    }

    load().catch((ex) => {
      if (alive) setLoadError((ex as Error).message)
    })

    return () => {
      alive = false
    }
  }, [pidProp, aid])

  if (loadError) {
    return (
      <Alert variant="destructive">
        <AlertTitle>This page could not be loaded</AlertTitle>
        <AlertDescription>{loadError}</AlertDescription>
      </Alert>
    )
  }

  if (!patient) return <PageSkeleton />

  const profileValues = { age: patient.age, sex: patient.sex }
  const setValue = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }))
    setErrors((prev) => {
      if (!(key in prev)) return prev
      const next = { ...prev }
      delete next[key as string]
      return next
    })
  }

  const fill = (values: Partial<Inputs>) =>
    setForm((prev) => withValues(prev, { ...values, ...profileValues }))

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    const found: Record<string, string> = {}
    const body: Record<string, number | string | null> = {}

    for (const key of NUMERIC) {
      if (key === "cholesterol" && form.cholMissing) {
        body.cholesterol = null
        continue
      }
      const raw = form[key].trim()
      const value = Number(raw)
      const [lo, hi] = LIMITS[key]
      if (raw === "" || Number.isNaN(value)) found[key] = "Enter a value"
      else if (value < lo || value > hi)
        found[key] = `Expected between ${lo} and ${hi}`
      else body[key] = value
    }
    for (const key of RADIOS) {
      const value = form[key]
      if (value === null) found[key] = "Choose one"
      else body[key] = value
    }
    body.notes = form.notes.trim() || null

    setErrors(found)
    if (Object.keys(found).length) {
      notifyError("Some values need attention before assessing")
      const first = document.getElementById(Object.keys(found)[0])
      first?.focus()
      first?.scrollIntoView({ behavior: "smooth", block: "center" })
      return
    }

    setStatus("pending")
    setResult(null)
    setSavedNote(null)
    try {
      const assessment = await api.assess(
        patient.id,
        body as unknown as AssessmentBody
      )
      setResult(assessment.result ?? null)
      setStatus(assessment.result ? "result" : "idle")
      setLastInputs(assessment.inputs)
      setVisitCount((n) => n + 1)
      const where = self ? "#history" : `#patient/${patient.id}`
      setSavedNote(
        <>
          Saved on {fmtDate(assessment.created_at)} at{" "}
          {fmtTime(assessment.created_at)} to{" "}
          {self ? "your" : `${patient.full_name}'s`} history.{" "}
          <a
            href={where}
            className="font-semibold underline underline-offset-4"
          >
            View the history
          </a>
        </>
      )
      notify("Assessment saved")
      if (window.matchMedia("(max-width: 1080px)").matches) {
        readoutRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        })
      }
    } catch (ex) {
      setStatus("idle")
      notifyError(`Assessment failed: ${(ex as Error).message}`)
    }
  }

  const who = `${patient.full_name}, ${patient.age} years, ${sexWord(patient.sex)}`

  return (
    <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,400px)_minmax(0,1fr)]">
      <form onSubmit={onSubmit} className="flex flex-col gap-6">
        <div>
          <PageHead
            title={
              saved
                ? `Assessment of ${fmtDate(saved.created_at)}`
                : self
                  ? "New assessment"
                  : `New assessment for ${patient.full_name}`
            }
            description={
              saved
                ? `${who}. Entered by ${saved.created_by_name} at ${fmtTime(saved.created_at)}. Change any value and select Assess and save to record a new visit; this one stays in the history.`
                : `${who}. Age and sex come from the profile.${
                    visitCount ? ` Visit ${visitCount + 1}.` : " First visit."
                  }`
            }
            back={
              self && !saved
                ? undefined
                : {
                    href: self ? "#history" : `#patient/${patient.id}`,
                    label: self
                      ? "My history"
                      : `${patient.full_name}'s history`,
                  }
            }
          />
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            Fill with
            {lastInputs && !saved ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  fill(lastInputs)
                  notify(
                    "Filled with the values from the last visit. Update what has changed."
                  )
                }}
              >
                last visit&apos;s values
              </Button>
            ) : null}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => fill(EXAMPLES.low)}
            >
              low-risk example
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => fill(EXAMPLES.high)}
            >
              high-risk example
            </Button>
          </div>
        </div>

        <FieldSet>
          <FieldLegend variant="label">Patient</FieldLegend>
          <FieldGroup>
            <div className="grid gap-4 sm:grid-cols-2">
              <NumberField
                name="age"
                label="Age"
                value={form.age}
                error={errors.age}
                onChange={(v) => setValue("age", v)}
              />
              <Field data-invalid={errors.sex ? "true" : undefined}>
                <FieldTitle id="sex-label">Sex</FieldTitle>
                <ChoiceGroup
                  ariaLabelledBy="sex-label"
                  choices={CHOICES.sex}
                  value={form.sex}
                  invalid={Boolean(errors.sex)}
                  onChange={(v) => setValue("sex", v)}
                />
                {errors.sex ? <FieldError>{errors.sex}</FieldError> : null}
              </Field>
            </div>
          </FieldGroup>
        </FieldSet>

        <FieldSet>
          <FieldLegend variant="label">Symptoms</FieldLegend>
          <FieldGroup>
            <RadioField
              name="chest_pain_type"
              label="Chest pain type"
              form={form}
              errors={errors}
              setValue={setValue}
            />
            <RadioField
              name="exercise_angina"
              label="Angina during exercise"
              form={form}
              errors={errors}
              setValue={setValue}
            />
          </FieldGroup>
        </FieldSet>

        <FieldSet>
          <FieldLegend variant="label">Vitals and labs</FieldLegend>
          <FieldGroup>
            <div className="grid gap-4 sm:grid-cols-2">
              <NumberField
                name="resting_bp_s"
                label="Resting blood pressure"
                value={form.resting_bp_s}
                error={errors.resting_bp_s}
                onChange={(v) => setValue("resting_bp_s", v)}
              />
              <NumberField
                name="max_heart_rate"
                label="Maximum heart rate"
                value={form.max_heart_rate}
                error={errors.max_heart_rate}
                onChange={(v) => setValue("max_heart_rate", v)}
              />
            </div>
            <Field data-invalid={errors.cholesterol ? "true" : undefined}>
              <FieldLabel htmlFor="cholesterol">Serum cholesterol</FieldLabel>
              <InputGroup>
                <InputGroupInput
                  id="cholesterol"
                  type="number"
                  inputMode="numeric"
                  min={LIMITS.cholesterol[0]}
                  max={LIMITS.cholesterol[1]}
                  step={1}
                  disabled={form.cholMissing}
                  aria-invalid={errors.cholesterol ? true : undefined}
                  value={form.cholesterol}
                  onChange={(e) => setValue("cholesterol", e.target.value)}
                />
                <InputGroupAddon align="inline-end">
                  <InputGroupText>{UNITS.cholesterol}</InputGroupText>
                </InputGroupAddon>
              </InputGroup>
              {errors.cholesterol ? (
                <FieldError>{errors.cholesterol}</FieldError>
              ) : null}
              <label className="mt-1 flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
                <Checkbox
                  checked={form.cholMissing}
                  onCheckedChange={(checked: boolean) => {
                    setValue("cholMissing", checked)
                    if (checked) setValue("cholesterol", "")
                  }}
                />
                Not measured (the model estimates it from the other values)
              </label>
            </Field>
            <RadioField
              name="fasting_blood_sugar"
              label="Fasting blood sugar above 120 mg/dl"
              form={form}
              errors={errors}
              setValue={setValue}
            />
          </FieldGroup>
        </FieldSet>

        <FieldSet>
          <FieldLegend variant="label">ECG</FieldLegend>
          <FieldGroup>
            <RadioField
              name="resting_ecg"
              label="Resting ECG"
              form={form}
              errors={errors}
              setValue={setValue}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <RadioField
                name="ST_slope"
                label="ST slope at peak exercise"
                form={form}
                errors={errors}
                setValue={setValue}
              />
              <NumberField
                name="oldpeak"
                label="ST depression"
                value={form.oldpeak}
                error={errors.oldpeak}
                step={0.1}
                description="Exercise relative to rest (oldpeak)"
                onChange={(v) => setValue("oldpeak", v)}
              />
            </div>
          </FieldGroup>
        </FieldSet>

        <FieldSet>
          <FieldLegend variant="label">Notes</FieldLegend>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="notes" className="sr-only">
                Notes
              </FieldLabel>
              <Textarea
                id="notes"
                maxLength={1000}
                rows={3}
                placeholder="Optional, saved with this assessment"
                value={form.notes}
                onChange={(e) => setValue("notes", e.target.value)}
              />
            </Field>
          </FieldGroup>
        </FieldSet>

        <div className="flex flex-wrap gap-3">
          <Button type="submit" size="lg" disabled={status === "pending"}>
            {status === "pending" ? <Spinner data-icon="inline-start" /> : null}
            {status === "pending" ? "Assessing" : "Assess and save"}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="lg"
            onClick={() => {
              setForm(withValues(EMPTY, profileValues))
              setErrors({})
              setResult(null)
              setStatus("idle")
              setSavedNote(null)
            }}
          >
            Clear form
          </Button>
        </div>
      </form>

      <div ref={readoutRef} className="flex flex-col gap-6" aria-live="polite">
        <Card>
          <CardHeader>
            <CardTitle>Probability of heart disease</CardTitle>
            <CardDescription>
              {result
                ? `Referral band ${pct(result.band.refer_low)} to ${pct(result.band.refer_high)}`
                : "Referral band from the model's 90% prediction sets"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <RiskStrip
              probability={result?.probability ?? null}
              status={status}
              band={result?.band}
              threshold={result?.threshold}
              description={
                result
                  ? `Probability ${pct(result.probability)}. ${result.decision}.`
                  : "Risk strip. No result yet."
              }
            />
          </CardContent>
        </Card>

        <Verdict status={status} result={result} savedNote={savedNote} />

        {status === "pending" ? (
          <Card>
            <CardHeader>
              <CardTitle>What drove this prediction</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              {Array.from({ length: 6 }, (_, i) => (
                <Skeleton key={i} className="h-8 w-full" />
              ))}
            </CardContent>
          </Card>
        ) : null}

        {status === "result" && result?.explanation ? (
          <Explanation result={result} />
        ) : null}
      </div>
    </div>
  )
}

function NumberField({
  name,
  label,
  value,
  error,
  step = 1,
  description,
  onChange,
}: {
  name: NumericKey
  label: string
  value: string
  error?: string
  step?: number
  description?: string
  onChange: (value: string) => void
}) {
  const [lo, hi] = LIMITS[name]
  return (
    <Field data-invalid={error ? "true" : undefined}>
      <FieldLabel htmlFor={name}>{label}</FieldLabel>
      <InputGroup>
        <InputGroupInput
          id={name}
          type="number"
          inputMode={step === 1 ? "numeric" : "decimal"}
          min={lo}
          max={hi}
          step={step}
          aria-invalid={error ? true : undefined}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        <InputGroupAddon align="inline-end">
          <InputGroupText>{UNITS[name]}</InputGroupText>
        </InputGroupAddon>
      </InputGroup>
      {error ? <FieldError>{error}</FieldError> : null}
      {description && !error ? (
        <FieldDescription>{description}</FieldDescription>
      ) : null}
    </Field>
  )
}

function RadioField({
  name,
  label,
  form,
  errors,
  setValue,
}: {
  name: RadioKey
  label: string
  form: FormState
  errors: Partial<Record<string, string>>
  setValue: (key: RadioKey, value: number) => void
}) {
  const error = errors[name]
  return (
    <Field data-invalid={error ? "true" : undefined}>
      <FieldTitle id={`${name}-label`}>{label}</FieldTitle>
      <ChoiceGroup
        ariaLabelledBy={`${name}-label`}
        choices={CHOICES[name]}
        value={form[name]}
        invalid={Boolean(error)}
        onChange={(v) => setValue(name, v)}
      />
      {error ? <FieldError>{error}</FieldError> : null}
    </Field>
  )
}

const TONE = {
  risk: "border-risk/40 bg-risk-tint",
  refer: "border-refer/40 bg-refer-tint",
  safe: "border-safe/40 bg-safe-tint",
} as const

function Verdict({
  status,
  result,
  savedNote,
}: {
  status: "idle" | "pending" | "result"
  result: Result | null
  savedNote: React.ReactNode
}) {
  if (status !== "result" || !result) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>
            {status === "pending" ? "Assessing" : "No assessment yet"}
          </CardTitle>
          <CardDescription>
            {status === "pending"
              ? "Running the ensemble and computing the explanation. This takes a few seconds."
              : "Enter the patient's values and select Assess and save. The probability, how certain the model is, and the inputs that drove the result will appear here."}
          </CardDescription>
        </CardHeader>
      </Card>
    )
  }

  const kind = verdictKind(result.decision)
  const { refer_low: lo, refer_high: hi } = result.band
  const above = result.probability >= result.threshold
  const text =
    kind === "refer"
      ? `The estimated probability is ${pct(result.probability)}, inside the referral band (${pct(lo)} to ${pct(hi)}). At this level the model's 90% prediction set contains both outcomes, so it does not commit to a label. Review with a clinician.`
      : `The estimated probability of heart disease is ${pct(result.probability)}, ${above ? "above" : "below"} the decision threshold of ${pct(result.threshold)}. The 90% prediction set contains only "${result.conformal_set[0]}".`

  const notices = [...(result.warnings ?? [])]
  const estimated = result.explanation?.estimated_inputs ?? {}
  if (estimated.cholesterol != null)
    notices.unshift(
      `Cholesterol was not measured. The model estimated ${Math.round(estimated.cholesterol)} mg/dl from the other values.`
    )
  if (estimated.resting_bp_s != null)
    notices.unshift(
      `Resting blood pressure was missing. The model estimated ${Math.round(estimated.resting_bp_s)} mmHg.`
    )

  return (
    <Card className={TONE[kind]}>
      <CardHeader>
        <CardTitle className="text-xl">
          {result.decision.replace(" - ", ": ")}
        </CardTitle>
        <CardDescription className="text-foreground/80">{text}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <div>
            <dt className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              Probability
            </dt>
            <dd className="text-3xl font-extrabold">
              {pct(result.probability)}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              Prediction
            </dt>
            <dd className="font-semibold">{result.prediction}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              Prediction set
            </dt>
            <dd className="font-semibold">
              {result.conformal_set.length
                ? result.conformal_set.join(" or ")
                : "Empty"}
            </dd>
          </div>
        </dl>

        {notices.length ? (
          <ul className="flex flex-col gap-2">
            {notices.map((n) => (
              <li key={n} className="flex gap-2 text-sm">
                <Badge variant="secondary" className="mt-0.5 shrink-0">
                  Note
                </Badge>
                <span>{n}</span>
              </li>
            ))}
          </ul>
        ) : null}

        {savedNote ? (
          <p className="text-sm text-muted-foreground">{savedNote}</p>
        ) : null}
      </CardContent>
    </Card>
  )
}

function Explanation({ result }: { result: Result }) {
  const ex = result.explanation
  if (!ex) return null

  const ups = ex.contributions.filter((c) => c.shap > 0.005).slice(0, 3)
  const downs = ex.contributions.filter((c) => c.shap < -0.005).slice(0, 3)

  return (
    <Card>
      <CardHeader>
        <CardTitle>What drove this prediction</CardTitle>
        <CardDescription>
          Each bar shows how far one input moved the probability, starting from
          the average training patient ({pct(ex.base_value)}) and ending at this
          patient ({pct(result.probability)}). Red bars raise the risk, green
          bars lower it.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <ShapWaterfall explanation={ex} probability={result.probability} />
        <p className="text-sm">
          {ups.length ? (
            <>
              Raised the risk most:{" "}
              {ups.map((c, i) => (
                <React.Fragment key={c.label}>
                  {i > 0 ? ", " : ""}
                  <b>{c.label}</b> ({c.display})
                </React.Fragment>
              ))}
              .{" "}
            </>
          ) : null}
          {downs.length ? (
            <>
              Lowered it most:{" "}
              {downs.map((c, i) => (
                <React.Fragment key={c.label}>
                  {i > 0 ? ", " : ""}
                  <b>{c.label}</b> ({c.display})
                </React.Fragment>
              ))}
              .
            </>
          ) : null}
          {!ups.length && !downs.length
            ? "No single input moved the probability by more than half a point."
            : null}
        </p>
        <p className="text-sm text-muted-foreground">
          {ex.method}. Contributions add up to the prediction (difference{" "}
          {Math.abs(ex.additivity_error * 100).toFixed(2)} pts). They explain
          the model, not medical causation.
        </p>
      </CardContent>
    </Card>
  )
}

function PageSkeleton() {
  return (
    <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,400px)_minmax(0,1fr)]">
      <div className="flex flex-col gap-4">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
      <div className="flex flex-col gap-4">
        <Skeleton className="h-60 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    </div>
  )
}
