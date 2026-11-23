import * as React from "react"
import { ActivityIcon, BarChart3Icon, UsersIcon } from "lucide-react"

import { BrandLockup, HeroArt } from "@/components/brand"
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
import { notify } from "@/lib/notify"
import { useSession } from "@/lib/session"
import type { PublicDoctor, User } from "@/lib/types"

const POINTS = [
  {
    icon: ActivityIcon,
    title: "Risk assessment",
    body: "from 11 values a clinic already records, such as blood pressure, cholesterol and the ECG.",
  },
  {
    icon: BarChart3Icon,
    title: "Explained results.",
    body: "Every prediction shows which values raised or lowered the risk.",
  },
  {
    icon: UsersIcon,
    title: "Shared history.",
    body: "Each visit is saved with its date, and the doctors you choose can see it.",
  },
]

function UniLogo() {
  const [failed, setFailed] = React.useState(false)
  if (failed) {
    return (
      <span className="flex size-11 items-center justify-center rounded-xl bg-white/15 text-sm font-extrabold">
        AMU
      </span>
    )
  }
  return (
    <img
      src="/static/img/amu-logo.png"
      alt="Aligarh Muslim University logo"
      className="size-11 rounded-xl bg-white/90 object-contain p-1"
      onError={() => setFailed(true)}
    />
  )
}

export function AuthPage({
  initial = "login",
}: {
  initial?: "login" | "register"
}) {
  const [mode, setMode] = React.useState<"login" | "register">(initial)

  return (
    <div className="grid min-h-svh lg:grid-cols-[1.05fr_1fr]">
      <section
        aria-label="About the Smart Healthcare System"
        className="relative hidden flex-col justify-between overflow-hidden bg-linear-160 from-primary to-brand-deep p-10 text-white lg:flex"
      >
        {/* Optional drop-ins, see public/img/README.md: both fall back cleanly. */}
        <img
          src="/static/img/hero.jpg"
          alt=""
          aria-hidden="true"
          className="absolute inset-0 size-full object-cover opacity-25 mix-blend-luminosity"
          onError={(e) => e.currentTarget.remove()}
        />

        <div className="relative z-10 flex items-center gap-3">
          <UniLogo />
          <span className="flex flex-col leading-tight">
            <b>Aligarh Muslim University</b>
            <small className="text-white/75">
              B.Tech Computer Engineering (AI), final-year project
            </small>
          </span>
        </div>

        <div className="relative z-10 max-w-xl">
          <h1 className="text-4xl font-extrabold tracking-tight">
            Smart Healthcare System for Heart Patients
          </h1>
          <p className="mt-3 text-lg text-white/80">
            Assess heart disease risk from routine clinical values, see what
            drives each result, and keep a dated record that your doctors can
            follow.
          </p>
          <ul className="mt-7 flex flex-col gap-4">
            {POINTS.map(({ icon: Icon, title, body }) => (
              <li key={title} className="flex gap-3">
                <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-white/15">
                  <Icon className="size-4.5" />
                </span>
                <span className="text-white/85">
                  <b className="text-white">{title}</b> {body}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <HeroArt className="pointer-events-none absolute right-0 -bottom-6 z-0 h-[40%] max-h-88 opacity-85" />

        <p className="relative z-10 text-sm text-white/70">
          Created by <b className="text-white">Syed Basil Rizvi</b>
        </p>
      </section>

      <section className="flex flex-col items-center justify-center gap-6 p-6 sm:p-10">
        <div className="w-full max-w-md">
          <div className="mb-6">
            <BrandLockup />
          </div>
          {mode === "login" ? (
            <SignInForm onSwitch={() => setMode("register")} />
          ) : (
            <RegisterForm onSwitch={() => setMode("login")} />
          )}
        </div>
        <p className="max-w-md text-center text-sm text-muted-foreground">
          Research prototype for academic use. Results support, and do not
          replace, a doctor&apos;s judgement.
        </p>
      </section>
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

      <Button type="submit" size="lg" disabled={busy}>
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
      notify("Account created. Welcome to SmartHeart.")
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

      <Button type="submit" size="lg" disabled={busy}>
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
