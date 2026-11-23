import * as React from "react"

import { AppShell } from "@/components/app-shell"
import { ConfirmProvider } from "@/components/confirm-dialog"
import { Toaster } from "@/components/ui/toast"
import { useHashRoute } from "@/hooks/use-hash-route"
import { ALLOWED, HOME, PARENT_TAB } from "@/lib/constants"
import { SessionProvider, useSession } from "@/lib/session"
import { AssessPage } from "@/pages/assess-page"
import { AssessmentsPage } from "@/pages/assessments-page"
import { AuthPage } from "@/pages/auth-page"
import { DoctorsAdminPage } from "@/pages/doctors-admin-page"
import { ModelPage } from "@/pages/model-page"
import { MyDoctorsPage } from "@/pages/my-doctors-page"
import { OverviewPage } from "@/pages/overview-page"
import { PatientPage } from "@/pages/patient-page"
import { PatientsPage } from "@/pages/patients-page"

export function App() {
  return (
    <SessionProvider>
      <ConfirmProvider>
        <Routes />
      </ConfirmProvider>
      <Toaster />
    </SessionProvider>
  )
}

function Routes() {
  const { user, ready } = useSession()
  const { view, arg } = useHashRoute()
  const [reloadKey, setReloadKey] = React.useState(0)

  // A view the role may not open sends it back to that role's start page.
  React.useEffect(() => {
    if (!user) return
    if (!view || !ALLOWED[user.role].includes(view)) {
      window.location.hash = HOME[user.role]
    }
  }, [user, view])

  React.useEffect(() => {
    window.scrollTo(0, 0)
  }, [view, arg])

  if (!ready) return null

  if (!user) {
    return <AuthPage initial={view === "register" ? "register" : "login"} />
  }

  const role = user.role
  const current = ALLOWED[role].includes(view) ? view : HOME[role]
  const activeTab = PARENT_TAB[current]?.(role) ?? current

  return (
    <AppShell
      activeTab={activeTab}
      onProfileSaved={() => setReloadKey((n) => n + 1)}
    >
      <Page
        key={`${current}/${arg ?? ""}/${reloadKey}`}
        view={current}
        arg={arg}
      />
    </AppShell>
  )
}

function Page({ view, arg }: { view: string; arg: string | undefined }) {
  const { user } = useSession()
  if (!user) return null

  switch (view) {
    case "assess":
      return (
        <AssessPage pid={user.role === "patient" ? user.id : Number(arg)} />
      )
    case "assessment":
      return <AssessPage aid={Number(arg)} />
    case "history":
      return <PatientPage pid={user.id} />
    case "patient":
      return <PatientPage pid={Number(arg)} />
    case "patients":
      return <PatientsPage />
    case "doctors":
      return user.role === "admin" ? <DoctorsAdminPage /> : <MyDoctorsPage />
    case "overview":
      return <OverviewPage />
    case "assessments":
      return <AssessmentsPage />
    case "model":
      return <ModelPage />
    default:
      return null
  }
}

export default App
