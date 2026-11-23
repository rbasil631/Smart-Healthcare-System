import * as React from "react"
import { SearchIcon } from "lucide-react"

import { useConfirm } from "@/components/confirm-dialog"
import { PageHead } from "@/components/page-head"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
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
import { notify, notifyError } from "@/lib/notify"
import type { Doctor } from "@/lib/types"
import { PageError, PageLoading } from "@/pages/page-state"

export function MyDoctorsPage() {
  const confirm = useConfirm()
  const [query, setQuery] = React.useState("")
  const { data, error, loading, reload } = useAsync(
    () => Promise.all([api.myDoctors(), api.doctors()]),
    []
  )

  if (loading && !data) return <PageLoading />
  if (error) return <PageError message={error} />
  if (!data) return null

  const [mine, all] = data as [Doctor[], Doctor[]]
  const mineIds = new Set(mine.map((d) => d.id))
  const others = all.filter((d) => !mineIds.has(d.id))

  const q = query.trim().toLowerCase()
  const list = others.filter(
    (d) =>
      !q ||
      [d.full_name, d.specialty, d.hospital].join(" ").toLowerCase().includes(q)
  )

  const add = async (doctor: Doctor) => {
    try {
      await api.addMyDoctor(doctor.id)
      notify("Doctor added")
      reload()
    } catch (ex) {
      notifyError((ex as Error).message)
    }
  }

  const remove = async (doctor: Doctor) => {
    const ok = await confirm({
      title: `Remove ${doctor.full_name}?`,
      text: "They will no longer see your assessments. You can add them again later.",
      okLabel: "Remove",
      danger: true,
    })
    if (!ok) return
    try {
      await api.removeMyDoctor(doctor.id)
      notify("Doctor removed")
      reload()
    } catch (ex) {
      notifyError((ex as Error).message)
    }
  }

  return (
    <div className="view-enter flex flex-col gap-6">
      <PageHead
        title="My doctors"
        description="Doctors you add can see all your assessments and record new ones for you. You can remove them at any time."
      />

      {mine.length ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {mine.map((d) => (
            <DoctorCard
              key={d.id}
              doctor={d}
              mine
              onAction={() => void remove(d)}
            />
          ))}
        </div>
      ) : (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>No doctor chosen yet</EmptyTitle>
            <EmptyDescription>
              Add one or more doctors below so they can follow your results.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-bold">Find a doctor</h2>
        <InputGroup className="h-9 w-72">
          <InputGroupAddon>
            <SearchIcon />
          </InputGroupAddon>
          <InputGroupInput
            type="search"
            placeholder="Search by name, specialty or hospital"
            aria-label="Search doctors"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </InputGroup>
      </div>

      {list.length ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {list.map((d) => (
            <DoctorCard key={d.id} doctor={d} onAction={() => void add(d)} />
          ))}
        </div>
      ) : (
        <p className="text-muted-foreground">
          {others.length
            ? `No doctor matches “${query}”.`
            : "You have added every available doctor."}
        </p>
      )}
    </div>
  )
}

function DoctorCard({
  doctor,
  mine = false,
  onAction,
}: {
  doctor: Doctor
  mine?: boolean
  onAction: () => void
}) {
  return (
    <Card className={mine ? "border-primary/40" : undefined}>
      <CardHeader>
        <CardTitle>{doctor.full_name}</CardTitle>
        <CardDescription>{doctor.hospital}</CardDescription>
        <Badge variant="secondary" className="ml-auto">
          {doctor.specialty}
        </Badge>
      </CardHeader>
      {doctor.bio ? (
        <CardContent>
          <p className="text-sm text-muted-foreground">{doctor.bio}</p>
        </CardContent>
      ) : null}
      <CardFooter>
        <Button
          variant={mine ? "destructive" : "default"}
          size="sm"
          onClick={onAction}
        >
          {mine ? "Remove" : "Add as my doctor"}
        </Button>
      </CardFooter>
    </Card>
  )
}
