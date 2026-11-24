import * as React from "react"
import {
  ActivityIcon,
  BarChart3Icon,
  HeartPulseIcon,
  ShieldCheckIcon,
  UsersIcon,
} from "lucide-react"

import {
  AmuLogo,
  BrandLockup,
  EcgLine,
  FloatingMarks,
} from "@/components/brand"
import { ChoiceGroup } from "@/components/choice-group"
import { Alert, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldTitle,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { api } from "@/lib/api"
import { CHOICES, HOME, USERNAME_RE } from "@/lib/constants"
import { SLIDES } from "@/lib/media"
import { notify } from "@/lib/notify"
import { useSession } from "@/lib/session"
import type { PublicDoctor, User } from "@/lib/types"

const POINTS = [
  {
    icon: ActivityIcon,
    title: "Risk assessment",
    body: "from 11 values a clinic already records: blood pressure, cholesterol, ECG.",
  },
  {
    icon: BarChart3Icon,
    title: "Explained results",
    body: "Each prediction shows which values raised or lowered the risk.",
  },
  {
    icon: UsersIcon,
    title: "Shared history",
    body: "Every visit is saved with its date for the doctors you choose.",
  },
]

const STATS = [
  { value: "918", label: "patients in the study" },
  { value: "4", label: "hospitals" },
  { value: "0.93", label: "AUC on held-out data" },
]

/** Full-bleed photographs that cross-fade with a slow zoom. */
function Slideshow({ index }: { index: number }) {
  return (
    <div aria-hidden="true" className="absolute inset-0 overflow-hidden">
      {SLIDES.map((slide, i) => (
        <div
          key={slide.src}
          className="absolute inset-0 transition-opacity duration-[1600ms] ease-in-out"
          style={{ opacity: i === index ? 1 : 0 }}
        >
          <img
            src={slide.src}
            alt=""
            className="ken-burns size-full object-cover"
            onError={(e) => (e.currentTarget.style.display = "none")}
          />
        </div>
      ))}
    </div>
  )
}

function useSlideIndex(count: number, ms = 6500) {
  const [index, setIndex] = React.useState(0)
  React.useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return
    const id = window.setInterval(() => setIndex((i) => (i + 1) % count), ms)
    return () => window.clearInterval(id)
  }, [count, ms])
  return [index, setIndex] as const
}

export function AuthPage({
  initial = "login",
}: {
  initial?: "login" | "register"
}) {
  const [mode, setMode] = React.useState<"login" | "register">(initial)
  const [slide, setSlide] = useSlideIndex(SLIDES.length)

  return (
    <div className="relative isolate flex min-h-svh flex-col overflow-hidden bg-brand-deep text-white">
      {/* Background: gradient first, then photos, then a tint so text stays readable. */}
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-20 bg-linear-150 from-primary via-brand-deep to-[#06121f]"
      />
      <div className="absolute inset-0 -z-10">
        <Slideshow index={slide} />
        <div className="absolute inset-0 bg-linear-to-r from-[#061a2e]/95 via-[#0a2e4f]/80 to-[#0a2e4f]/45" />
        <div className="absolute inset-0 bg-linear-to-t from-[#04101c]/90 via-transparent to-[#04101c]/40" />
        <FloatingMarks />
        <EcgLine
          className="absolute inset-x-0 bottom-14 h-20 text-[#ff5d73] opacity-60"
          beats={5}
        />
      </div>

      {/* Top bar: university identity */}
      <header className="relative z-10 mx-auto flex w-full max-w-7xl items-center justify-between gap-4 px-5 pt-6 fade-in sm:px-8">
        <div className="flex items-center gap-3">
          <AmuLogo className="size-14 sm:size-16" />
          <span className="flex flex-col leading-tight">
            <b className="text-base sm:text-lg">Aligarh Muslim University</b>
            <small className="text-xs text-white/75 sm:text-sm">
              Interdisciplinary Centre for Artificial Intelligence
            </small>
          </span>
        </div>
        <span className="hidden items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1.5 text-xs font-semibold backdrop-blur-md sm:inline-flex">
          <HeartPulseIcon className="heartbeat size-4 text-[#ff8a98]" />
          B.Tech (AI) Major Project
        </span>
      </header>

      <main className="relative z-10 mx-auto grid w-full max-w-7xl flex-1 items-center gap-10 px-5 py-10 sm:px-8 lg:grid-cols-[1.1fr_minmax(0,460px)] lg:gap-16">
        {/* Story */}
        <section
          aria-label="About the Smart Healthcare System"
          className="stagger"
        >
          <div className="mb-5 inline-flex items-center gap-2 rounded-full bg-[#ff5d73]/15 px-3 py-1 text-xs font-bold tracking-wider text-[#ffb3bd] uppercase ring-1 ring-[#ff5d73]/30">
            <HeartPulseIcon className="heartbeat size-4" />
            Cardiology · Explainable AI
          </div>
          <h1 className="text-4xl leading-[1.08] font-extrabold tracking-tight text-balance sm:text-5xl xl:text-6xl">
            Smart Healthcare System{" "}
            <span className="bg-linear-to-r from-[#ff8a98] via-[#ff5d73] to-[#ffc2a8] bg-clip-text text-transparent">
              for Heart Patients
            </span>
          </h1>
          <p className="mt-4 max-w-xl text-base text-white/80 sm:text-lg">
            Assess heart disease risk from routine clinical values, see what
            drives each result, and keep a dated record your doctors can follow.
          </p>

          <ul className="mt-7 hidden max-w-2xl gap-3 sm:grid sm:grid-cols-3">
            {POINTS.map(({ icon: Icon, title, body }) => (
              <li
                key={title}
                className="lift rounded-2xl border border-white/15 bg-white/[0.07] p-4 backdrop-blur-md hover:border-white/30"
              >
                <span className="mb-2 flex size-9 items-center justify-center rounded-xl bg-linear-135 from-[#ff5d73] to-[#c0263b] shadow-lg shadow-[#c0263b]/30">
                  <Icon className="size-4.5" />
                </span>
                <b className="block text-sm">{title}</b>
                <span className="text-sm text-white/70">{body}</span>
              </li>
            ))}
          </ul>

          <dl className="mt-7 hidden flex-wrap gap-x-10 gap-y-4 sm:flex">
            {STATS.map((s) => (
              <div key={s.label}>
                <dt className="sr-only">{s.label}</dt>
                <dd className="text-3xl font-extrabold tracking-tight">
                  {s.value}
                </dd>
                <dd className="text-xs font-semibold tracking-wide text-white/60 uppercase">
                  {s.label}
                </dd>
              </div>
            ))}
          </dl>

          <div className="mt-8 hidden items-center gap-3 lg:flex">
            {SLIDES.map((s, i) => (
              <button
                key={s.src}
                type="button"
                aria-label={`Show photo ${i + 1}: ${s.caption}`}
                onClick={() => setSlide(i)}
                className="h-1.5 rounded-full bg-white/30 transition-all duration-500 hover:bg-white/60 data-[on=true]:w-10 data-[on=true]:bg-white"
                style={{ width: i === slide ? undefined : 18 }}
                data-on={i === slide}
              />
            ))}
            <span key={slide} className="ml-2 text-sm text-white/70 fade-in">
              {SLIDES[slide].caption}
            </span>
          </div>
        </section>

        {/* Form card */}
        <section className="fade-up [animation-delay:.15s]">
          <div className="relative rounded-3xl bg-card p-6 text-card-foreground shadow-[0_30px_80px_-20px_rgba(0,0,0,.6)] ring-1 ring-white/20 sm:p-8">
            <div className="absolute inset-x-8 -top-px h-px bg-linear-to-r from-transparent via-[#ff5d73] to-transparent" />
            <div className="mb-6 flex items-center justify-between gap-3">
              <BrandLockup />
              <AmuLogo className="size-10 shadow-none ring-border" />
            </div>
            <div key={mode} className="fade-up">
              {mode === "login" ? (
                <SignInForm onSwitch={() => setMode("register")} />
              ) : (
                <RegisterForm onSwitch={() => setMode("login")} />
              )}
            </div>
            <p className="mt-6 flex items-start gap-2 border-t pt-4 text-xs text-muted-foreground">
              <ShieldCheckIcon className="mt-px size-4 shrink-0 text-safe" />
              Research prototype for academic use. Results support, and do not
              replace, a doctor&apos;s judgement.
            </p>
          </div>
        </section>
      </main>

      <footer className="relative z-10 border-t border-white/10 bg-[#04101c]/60 backdrop-blur-md">
        <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-5 py-4 text-sm sm:px-8">
          <span className="text-white/75">
            Created by <b className="text-white">Syed Basil Rizvi</b>,
            Interdisciplinary Centre for Artificial Intelligence
          </span>
          <span className="text-white/50">
            Aligarh Muslim University · © {new Date().getFullYear()}
          </span>
        </div>
      </footer>
    </div>
  )
}

function SignInForm({ onSwitch }: { onSwitch: () => void }) {
  const { setUser } = useSession()
  const [username, setUsername] = React.useState("")
  const [password, setPassword] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)
    if (!username.trim() || !password) {
      setError("Enter your username and password.")
      return
    }
    setBusy(true)
    try {
      const user = await api.login(username.trim(), password)
      setPassword("")
      enter(user, setUser)
    } catch (ex) {
      setError((ex as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5">
      <div>
        <h2 className="text-2xl font-extrabold tracking-tight">Sign in</h2>
        <p className="text-muted-foreground">
          Patients, doctors and administrators sign in with their username.
        </p>
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>{error}</AlertTitle>
        </Alert>
      ) : null}

      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="li-user">Username</FieldLabel>
          <Input
            id="li-user"
            autoComplete="username"
            autoFocus
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="li-pass">Password</FieldLabel>
          <Input
            id="li-pass"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
      </FieldGroup>

      <Button type="submit" size="lg" disabled={busy} className="shine">
        {busy ? <Spinner data-icon="inline-start" /> : null}
        Sign in
      </Button>

      <p className="text-sm text-muted-foreground">
        New patient?{" "}
        <Button
          variant="link"
          type="button"
          onClick={onSwitch}
          className="h-auto p-0"
        >
          Create an account
        </Button>
      </p>
    </form>
  )
}

function RegisterForm({ onSwitch }: { onSwitch: () => void }) {
  const { setUser } = useSession()
  const [doctors, setDoctors] = React.useState<PublicDoctor[] | null>(null)
  const [chosen, setChosen] = React.useState<number[]>([])
  const [form, setForm] = React.useState({
    full_name: "",
    username: "",
    date_of_birth: "",
    password: "",
    repeat: "",
    email: "",
    phone: "",
  })
  const [sex, setSex] = React.useState<number | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)

  React.useEffect(() => {
    let alive = true
    api
      .publicDoctors()
      .then((list) => {
        if (alive) setDoctors(list)
      })
      .catch(() => {
        if (alive) setDoctors([])
      })
    return () => {
      alive = false
    }
  }, [])

  const set = (key: keyof typeof form, value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }))

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)
    if (form.full_name.trim().length < 2)
      return setError("Enter your full name.")
    if (!USERNAME_RE.test(form.username.trim()))
      return setError(
        "Choose a username of 3 to 40 letters, digits, dots, dashes or underscores."
      )
    if (!form.date_of_birth) return setError("Enter your date of birth.")
    if (sex === null)
      return setError("Choose your sex. The model uses it in the assessment.")
    if (form.password.length < 8)
      return setError("The password needs at least 8 characters.")
    if (form.password !== form.repeat)
      return setError("The two passwords do not match.")

    setBusy(true)
    try {
      const user = await api.register({
        full_name: form.full_name.trim(),
        username: form.username.trim(),
        password: form.password,
        date_of_birth: form.date_of_birth,
        sex,
        email: form.email.trim() || null,
        phone: form.phone.trim() || null,
        doctor_ids: chosen,
      })
      notify("Account created. Welcome to the Smart Healthcare System.")
      enter(user, setUser)
    } catch (ex) {
      setError((ex as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5">
      <div>
        <h2 className="text-2xl font-extrabold tracking-tight">
          Create a patient account
        </h2>
        <p className="text-muted-foreground">
          You will use this username and password to see your results over time.
        </p>
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>{error}</AlertTitle>
        </Alert>
      ) : null}

      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="rg-name">Full name</FieldLabel>
          <Input
            id="rg-name"
            maxLength={80}
            autoComplete="name"
            value={form.full_name}
            onChange={(e) => set("full_name", e.target.value)}
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="rg-user">Username</FieldLabel>
            <Input
              id="rg-user"
              maxLength={40}
              autoComplete="username"
              value={form.username}
              onChange={(e) => set("username", e.target.value)}
            />
            <FieldDescription>Letters, digits, dots, dashes</FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="rg-dob">Date of birth</FieldLabel>
            <Input
              id="rg-dob"
              type="date"
              value={form.date_of_birth}
              onChange={(e) => set("date_of_birth", e.target.value)}
            />
          </Field>
        </div>

        <Field>
          <FieldTitle id="rg-sex-label">Sex</FieldTitle>
          <ChoiceGroup
            ariaLabelledBy="rg-sex-label"
            choices={CHOICES.sex}
            value={sex}
            onChange={setSex}
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="rg-pass">Password</FieldLabel>
            <Input
              id="rg-pass"
              type="password"
              autoComplete="new-password"
              value={form.password}
              onChange={(e) => set("password", e.target.value)}
            />
            <FieldDescription>At least 8 characters</FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="rg-pass2">Repeat password</FieldLabel>
            <Input
              id="rg-pass2"
              type="password"
              autoComplete="new-password"
              value={form.repeat}
              onChange={(e) => set("repeat", e.target.value)}
            />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="rg-email">
              Email <span className="text-muted-foreground">(optional)</span>
            </FieldLabel>
            <Input
              id="rg-email"
              type="email"
              maxLength={120}
              autoComplete="email"
              value={form.email}
              onChange={(e) => set("email", e.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="rg-phone">
              Phone <span className="text-muted-foreground">(optional)</span>
            </FieldLabel>
            <Input
              id="rg-phone"
              type="tel"
              maxLength={30}
              autoComplete="tel"
              value={form.phone}
              onChange={(e) => set("phone", e.target.value)}
            />
          </Field>
        </div>

        <Field>
          <FieldTitle>
            Your doctors{" "}
            <span className="font-normal text-muted-foreground">
              (optional, you can change this later)
            </span>
          </FieldTitle>
          <div className="flex max-h-56 flex-col gap-1 overflow-y-auto rounded-xl border p-2">
            {doctors === null ? (
              <p className="p-2 text-sm text-muted-foreground">
                Loading doctors…
              </p>
            ) : doctors.length === 0 ? (
              <p className="p-2 text-sm text-muted-foreground">
                Doctors could not be loaded. You can choose them after signing
                in.
              </p>
            ) : (
              doctors.map((d) => (
                <label
                  key={d.id}
                  className="flex cursor-pointer items-start gap-3 rounded-lg p-2 hover:bg-muted"
                >
                  <Checkbox
                    checked={chosen.includes(d.id)}
                    onCheckedChange={(checked: boolean) =>
                      setChosen((prev) =>
                        checked
                          ? [...prev, d.id]
                          : prev.filter((id) => id !== d.id)
                      )
                    }
                    className="mt-0.5"
                  />
                  <span className="flex flex-col">
                    <b className="text-sm">{d.full_name}</b>
                    <small className="text-muted-foreground">
                      {d.specialty}, {d.hospital}
                    </small>
                  </span>
                </label>
              ))
            )}
          </div>
          <FieldDescription>
            Doctors you choose can see your assessments.
          </FieldDescription>
        </Field>
      </FieldGroup>

      <Button type="submit" size="lg" disabled={busy} className="shine">
        {busy ? <Spinner data-icon="inline-start" /> : null}
        Create account
      </Button>

      <p className="text-sm text-muted-foreground">
        Already registered?{" "}
        <Button
          variant="link"
          type="button"
          onClick={onSwitch}
          className="h-auto p-0"
        >
          Sign in
        </Button>
      </p>
    </form>
  )
}

/** Signing in lands on the role's home view. */
function enter(user: User, setUser: (u: User) => void) {
  setUser(user)
  window.location.hash = HOME[user.role]
}
