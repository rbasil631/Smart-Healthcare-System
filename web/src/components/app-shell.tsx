import * as React from "react"
import { MoonIcon, SunIcon } from "lucide-react"

import { AmuLogo, BrandLockup, EcgLine } from "@/components/brand"
import { ChangePasswordDialog } from "@/components/change-password-dialog"
import { EditDetailsDialog } from "@/components/edit-details-dialog"
import { useTheme } from "@/components/theme-provider"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { HOME, NAV } from "@/lib/constants"
import { roleWord } from "@/lib/format"
import { useSession } from "@/lib/session"

/** What the page actually looks like now, which "system" alone does not say. */
function useIsDark() {
  const { theme } = useTheme()
  const [systemDark, setSystemDark] = React.useState(
    () => window.matchMedia("(prefers-color-scheme: dark)").matches
  )

  React.useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: dark)")
    const onChange = () => setSystemDark(query.matches)
    query.addEventListener("change", onChange)
    return () => query.removeEventListener("change", onChange)
  }, [])

  return theme === "system" ? systemDark : theme === "dark"
}

export function AppShell({
  activeTab,
  onProfileSaved,
  children,
}: {
  activeTab: string
  onProfileSaved: () => void
  children: React.ReactNode
}) {
  const { user, signOut } = useSession()
  const { setTheme } = useTheme()
  const isDark = useIsDark()
  const [editOpen, setEditOpen] = React.useState(false)
  const [pwOpen, setPwOpen] = React.useState(false)

  if (!user) return null

  return (
    <div className="app-backdrop flex min-h-svh flex-col">
      <header className="sticky top-0 z-40 border-b bg-card/90 shadow-[0_6px_24px_-18px_var(--brand-deep)] backdrop-blur-xl supports-backdrop-filter:bg-card/75">
        <div
          aria-hidden="true"
          className="relative h-1 overflow-hidden bg-linear-to-r from-primary via-heart to-primary"
        >
          <div className="absolute inset-0 animate-pulse bg-white/20" />
        </div>
        <div className="mx-auto flex h-16 w-full max-w-[1400px] items-center gap-6 px-4 sm:px-6">
          <a
            href={`#${HOME[user.role]}`}
            aria-label="Smart Healthcare System home"
            className="shrink-0"
          >
            <BrandLockup />
          </a>
          <span
            aria-hidden="true"
            className="hidden h-8 w-px bg-border xl:block"
          />
          <span
            className="hidden items-center gap-2 xl:flex"
            title="Aligarh Muslim University"
          >
            <AmuLogo className="size-9 shadow-none ring-border" />
            <span className="hidden flex-col text-[11px] leading-tight font-semibold text-muted-foreground 2xl:flex">
              <span>Aligarh Muslim University</span>
              <span>ICAI</span>
            </span>
          </span>

          <nav aria-label="Sections" className="hidden min-w-0 flex-1 md:block">
            <ul className="flex items-center gap-1">
              {NAV[user.role].map(([key, label]) => (
                <li key={key}>
                  <a
                    href={`#${key}`}
                    aria-current={activeTab === key ? "page" : undefined}
                    className="relative inline-flex h-9 items-center rounded-lg px-3 text-sm font-semibold text-muted-foreground transition-colors after:absolute after:inset-x-3 after:-bottom-[13px] after:h-0.5 after:origin-center after:scale-x-0 after:rounded-full after:bg-primary after:transition-transform after:duration-300 hover:bg-muted hover:text-foreground aria-[current=page]:bg-accent aria-[current=page]:text-accent-foreground aria-[current=page]:after:scale-x-100"
                  >
                    {label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>

          <div className="ml-auto flex items-center gap-2">
            <span className="hidden text-sm font-semibold 2xl:inline">
              {user.full_name}
            </span>
            <Badge variant="secondary" className="hidden sm:inline-flex">
              {roleWord(user.role)}
            </Badge>
            <Button
              variant="ghost"
              size="icon"
              aria-label={isDark ? "Use the light theme" : "Use the dark theme"}
              onClick={() => setTheme(isDark ? "light" : "dark")}
            >
              {isDark ? <MoonIcon /> : <SunIcon />}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setEditOpen(true)}>
              My details
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setPwOpen(true)}>
              Password
            </Button>
            <Button variant="outline" size="sm" onClick={() => void signOut()}>
              Sign out
            </Button>
          </div>
        </div>

        <nav aria-label="Sections" className="border-t md:hidden">
          <ul className="flex items-center gap-1 overflow-x-auto px-4 py-2">
            {NAV[user.role].map(([key, label]) => (
              <li key={key}>
                <a
                  href={`#${key}`}
                  aria-current={activeTab === key ? "page" : undefined}
                  className="inline-flex h-8 items-center rounded-lg px-3 text-sm font-semibold whitespace-nowrap text-muted-foreground hover:text-foreground aria-[current=page]:bg-accent aria-[current=page]:text-accent-foreground"
                >
                  {label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </header>

      <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-8 sm:px-6">
        {children}
      </main>

      <footer className="relative mt-6 overflow-hidden border-t bg-card/70 backdrop-blur">
        <EcgLine
          className="absolute inset-x-0 top-0 h-10 text-primary opacity-[0.18]"
          beats={8}
          glow={false}
        />
        <div className="relative mx-auto flex w-full max-w-[1400px] flex-wrap items-center justify-between gap-x-6 gap-y-3 px-4 py-6 text-sm text-muted-foreground sm:px-6">
          <span className="flex items-center gap-3">
            <AmuLogo className="size-10 shadow-none ring-border" />
            <span className="leading-snug">
              Created by <b className="text-foreground">Syed Basil Rizvi</b>
              <br />
              Interdisciplinary Centre for Artificial Intelligence, Aligarh
              Muslim University
            </span>
          </span>
          <span className="max-w-md">
            Research prototype. Predictions support, and do not replace,
            clinical judgement.
          </span>
        </div>
      </footer>

      <EditDetailsDialog
        person={user}
        role={user.role}
        open={editOpen}
        onOpenChange={setEditOpen}
        onSaved={onProfileSaved}
      />
      <ChangePasswordDialog open={pwOpen} onOpenChange={setPwOpen} />
    </div>
  )
}
