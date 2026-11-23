import * as React from "react"
import { MoonIcon, SunIcon } from "lucide-react"

import { BrandLockup } from "@/components/brand"
import { ChangePasswordDialog } from "@/components/change-password-dialog"
import { EditDetailsDialog } from "@/components/edit-details-dialog"
import { useTheme } from "@/components/theme-provider"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
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
    <div className="flex min-h-svh flex-col">
      <header className="sticky top-0 z-40 border-b bg-card/95 backdrop-blur supports-backdrop-filter:bg-card/80">
        <div className="mx-auto flex h-16 w-full max-w-[1400px] items-center gap-6 px-4 sm:px-6">
          <a
            href={`#${HOME[user.role]}`}
            aria-label="Smart Healthcare System home"
            className="shrink-0"
          >
            <BrandLockup />
          </a>

          <nav aria-label="Sections" className="hidden min-w-0 flex-1 md:block">
            <ul className="flex items-center gap-1">
              {NAV[user.role].map(([key, label]) => (
                <li key={key}>
                  <a
                    href={`#${key}`}
                    aria-current={activeTab === key ? "page" : undefined}
                    className="inline-flex h-9 items-center rounded-lg px-3 text-sm font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground aria-[current=page]:bg-accent aria-[current=page]:text-accent-foreground"
                  >
                    {label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>

          <div className="ml-auto flex items-center gap-2">
            <span className="hidden text-sm font-semibold lg:inline">
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

      <footer className="mx-auto w-full max-w-[1400px] px-4 pb-8 sm:px-6">
        <Separator className="mb-4" />
        <div className="flex flex-wrap justify-between gap-x-6 gap-y-1 text-sm text-muted-foreground">
          <span>
            Created by <b className="text-foreground">Syed Basil Rizvi</b>,
            B.Tech Computer Engineering (AI), Aligarh Muslim University
          </span>
          <span>
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
