import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"

export function PageLoading() {
  return (
    <div className="flex flex-col gap-4">
      <Skeleton className="h-10 w-90 max-w-full" />
      <Skeleton className="h-55 w-full" />
      <Skeleton className="h-40 w-full" />
    </div>
  )
}

export function PageError({
  message,
  home,
}: {
  message: string
  home?: string
}) {
  return (
    <Alert variant="destructive">
      <AlertTitle>This page could not be loaded</AlertTitle>
      <AlertDescription>
        <p>{message}</p>
        {home ? (
          <Button variant="outline" size="sm" render={<a href={`#${home}`} />}>
            Go to the start page
          </Button>
        ) : null}
      </AlertDescription>
    </Alert>
  )
}
