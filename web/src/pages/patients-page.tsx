import * as React from "react"
import { SearchIcon } from "lucide-react"

import { DecisionBadge } from "@/components/decision-badge"
import { PageHead } from "@/components/page-head"
import { PositionBar } from "@/components/position-bar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group"
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
import { fmtDate, pct, plural, sexWord } from "@/lib/format"
import { useSession } from "@/lib/session"
import { PageError, PageLoading } from "@/pages/page-state"

export function PatientsPage() {
  const { user } = useSession()
  const admin = user?.role === "admin"
  const [query, setQuery] = React.useState("")
  const { data, error, loading } = useAsync(() => api.patients(), [])

  if (loading && !data) return <PageLoading />
  if (error) return <PageError message={error} />
  if (!data) return null

  const q = query.trim().toLowerCase()
  const list = data.filter(
    (r) =>
      !q ||
      r.full_name.toLowerCase().includes(q) ||
      r.username.toLowerCase().includes(q)
  )

  return (
    <div className="view-enter flex flex-col gap-6">
      <PageHead
        title={admin ? "Patients" : "My patients"}
        description={
          admin
            ? `${plural(data.length, "registered patient")}.`
            : `${plural(data.length, "patient")} ${data.length === 1 ? "has" : "have"} chosen you or been assigned to you.`
        }
        actions={
          <InputGroup className="h-9 w-64">
            <InputGroupAddon>
              <SearchIcon />
            </InputGroupAddon>
            <InputGroupInput
              type="search"
              placeholder="Search by name or username"
              aria-label="Search patients"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </InputGroup>
        }
      />

      {data.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>No patients yet</EmptyTitle>
            <EmptyDescription>
              {admin
                ? "Patients appear here once they create an account."
                : "Patients add their doctors from their own account, or an administrator can assign them to you."}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : list.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>No matches</EmptyTitle>
            <EmptyDescription>
              No patient matches &ldquo;{query}&rdquo;.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Patient</TableHead>
                <TableHead>Age, sex</TableHead>
                <TableHead className="hidden lg:table-cell">
                  Assessments
                </TableHead>
                <TableHead className="text-right">Latest</TableHead>
                <TableHead className="hidden lg:table-cell">Position</TableHead>
                <TableHead>Decision</TableHead>
                {admin ? (
                  <>
                    <TableHead className="hidden xl:table-cell">
                      Doctors
                    </TableHead>
                    <TableHead className="hidden xl:table-cell">
                      Status
                    </TableHead>
                  </>
                ) : null}
                <TableHead>
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <a
                      href={`#patient/${r.id}`}
                      className="font-semibold hover:underline"
                    >
                      {r.full_name}
                    </a>
                    <br />
                    <small className="text-muted-foreground">
                      {r.username}
                    </small>
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {r.age}, {sexWord(r.sex)}
                  </TableCell>
                  <TableCell className="hidden lg:table-cell">
                    {r.n_assessments}
                    {r.last_assessed ? (
                      <>
                        <br />
                        <small className="text-muted-foreground">
                          last {fmtDate(r.last_assessed)}
                        </small>
                      </>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-right font-semibold">
                    {r.last_probability == null ? "–" : pct(r.last_probability)}
                  </TableCell>
                  <TableCell className="hidden lg:table-cell">
                    {r.last_probability == null ? null : (
                      <PositionBar probability={r.last_probability} />
                    )}
                  </TableCell>
                  <TableCell>
                    {r.last_decision ? (
                      <DecisionBadge decision={r.last_decision} />
                    ) : (
                      <span className="text-sm text-muted-foreground">
                        Not assessed
                      </span>
                    )}
                  </TableCell>
                  {admin ? (
                    <>
                      <TableCell className="hidden xl:table-cell">
                        {r.doctors.length ? (
                          r.doctors.map((d) => (
                            <span key={d.id} className="block text-sm">
                              {d.full_name}
                            </span>
                          ))
                        ) : (
                          <Badge variant="outline">None</Badge>
                        )}
                      </TableCell>
                      <TableCell className="hidden xl:table-cell">
                        <Badge
                          variant={r.is_active ? "secondary" : "destructive"}
                        >
                          {r.is_active ? "Active" : "Deactivated"}
                        </Badge>
                      </TableCell>
                    </>
                  ) : null}
                  <TableCell>
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        render={<a href={`#patient/${r.id}`} />}
                      >
                        Open
                      </Button>
                      {r.is_active ? (
                        <Button
                          variant="outline"
                          size="sm"
                          render={<a href={`#assess/${r.id}`} />}
                        >
                          Assess
                        </Button>
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
