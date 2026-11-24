import * as React from "react"
import { DownloadIcon, SearchIcon } from "lucide-react"

import { AssessmentTable } from "@/components/assessment-table"
import { PageHead } from "@/components/page-head"
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
import { useAsync } from "@/hooks/use-async"
import { api } from "@/lib/api"
import { plural } from "@/lib/format"
import { PageError, PageLoading } from "@/pages/page-state"

export function AssessmentsPage() {
  const [query, setQuery] = React.useState("")
  const { data, error, loading, reload } = useAsync(
    () => api.allAssessments(),
    []
  )

  if (loading && !data) return <PageLoading />
  if (error) return <PageError message={error} />
  if (!data) return null

  const q = query.trim().toLowerCase()
  const list = data.filter(
    (a) =>
      !q ||
      [a.patient_name, a.decision, a.notes ?? "", a.created_by_name]
        .join(" ")
        .toLowerCase()
        .includes(q)
  )

  return (
    <div className="view-enter stagger flex flex-col gap-6">
      <PageHead
        title="All assessments"
        description={`${plural(data.length, "assessment")}, newest first.`}
        actions={
          <>
            <InputGroup className="h-9 w-72">
              <InputGroupAddon>
                <SearchIcon />
              </InputGroupAddon>
              <InputGroupInput
                type="search"
                placeholder="Search patient, decision or notes"
                aria-label="Search assessments"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </InputGroup>
            <Button
              variant="outline"
              render={<a href="/api/admin/export.csv" download />}
            >
              <DownloadIcon data-icon="inline-start" />
              Export CSV
            </Button>
          </>
        }
      />

      {data.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>No assessments yet</EmptyTitle>
            <EmptyDescription>
              They appear here as patients and doctors record them.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : list.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>No matches</EmptyTitle>
            <EmptyDescription>
              Nothing matches &ldquo;{query}&rdquo;.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <AssessmentTable rows={list} showPatient canDelete onChanged={reload} />
      )}
    </div>
  )
}
