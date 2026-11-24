import { ChevronLeftIcon } from "lucide-react"
import type { ReactNode } from "react"

import { EcgLine } from "@/components/brand"
import { BANNER } from "@/lib/media"

/** Title, one explanatory line and the page's actions, shared by every view. */
export function PageHead({
  title,
  description,
  back,
  actions,
}: {
  title: ReactNode
  description?: ReactNode
  back?: { href: string; label: string }
  actions?: ReactNode
}) {
  return (
    <div className="relative mb-6 flex flex-wrap items-end justify-between gap-4 overflow-hidden rounded-2xl border bg-card px-5 pt-6 pb-8 shadow-[0_10px_30px_-24px_var(--brand-deep)] sm:px-7">
      <div aria-hidden="true" className="absolute inset-0 -z-0">
        <img
          src={BANNER}
          alt=""
          className="absolute inset-y-0 right-0 h-full w-2/3 [mask-image:linear-gradient(to_left,black,transparent)] object-cover opacity-[0.16] dark:opacity-[0.1]"
          onError={(e) => (e.currentTarget.style.display = "none")}
        />
        <div className="absolute -top-20 -left-16 size-56 rounded-full bg-primary/10 blur-3xl" />
        <EcgLine
          className="absolute inset-x-0 bottom-0 h-5 text-heart opacity-25"
          beats={4}
          glow={false}
        />
      </div>
      <div className="fade-up relative min-w-0">
        {back ? (
          <a
            href={back.href}
            className="mb-1 inline-flex items-center gap-1 text-sm font-semibold text-muted-foreground hover:text-foreground"
          >
            <ChevronLeftIcon className="size-4" />
            {back.label}
          </a>
        ) : null}
        <h1 className="flex items-center gap-3 text-2xl font-extrabold tracking-tight sm:text-3xl">
          <span
            aria-hidden="true"
            className="h-8 w-1.5 rounded-full bg-linear-to-b from-heart to-primary"
          />
          {title}
        </h1>
        {description ? (
          <p className="mt-1 max-w-3xl text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {actions ? (
        <div className="fade-up relative flex flex-wrap items-center gap-2 [animation-delay:.1s]">
          {actions}
        </div>
      ) : null}
    </div>
  )
}
