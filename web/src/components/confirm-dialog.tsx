import * as React from "react"

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Field, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"

export interface ConfirmRequest {
  title: string
  text?: string
  okLabel?: string
  danger?: boolean
  /** When set, the dialog asks for a password and resolves with it. */
  passwordLabel?: string
}

/** `true` when confirmed, the typed password when one was asked for, `null` on cancel. */
type ConfirmResult = string | true | null

type Confirm = (request: ConfirmRequest) => Promise<ConfirmResult>

const ConfirmContext = React.createContext<Confirm | undefined>(undefined)

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [request, setRequest] = React.useState<ConfirmRequest | null>(null)
  const [password, setPassword] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)
  const resolver = React.useRef<((value: ConfirmResult) => void) | null>(null)

  const confirm = React.useCallback<Confirm>((next) => {
    setRequest(next)
    setPassword("")
    setError(null)
    return new Promise<ConfirmResult>((resolve) => {
      resolver.current = resolve
    })
  }, [])

  const settle = React.useCallback((value: ConfirmResult) => {
    setRequest(null)
    resolver.current?.(value)
    resolver.current = null
  }, [])

  const onSubmit = (event: React.FormEvent) => {
    event.preventDefault()
    if (request?.passwordLabel) {
      if (password.length < 8) {
        setError("Use at least 8 characters.")
        return
      }
      settle(password)
      return
    }
    settle(true)
  }

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <AlertDialog
        open={request !== null}
        onOpenChange={(open) => {
          if (!open) settle(null)
        }}
      >
        <AlertDialogContent size="sm">
          <form onSubmit={onSubmit} className="flex flex-col gap-4">
            <AlertDialogHeader>
              <AlertDialogTitle>{request?.title ?? ""}</AlertDialogTitle>
              {request?.text ? (
                <AlertDialogDescription>{request.text}</AlertDialogDescription>
              ) : null}
            </AlertDialogHeader>

            {request?.passwordLabel ? (
              <Field data-invalid={error ? "true" : undefined}>
                <FieldLabel htmlFor="confirm-password">
                  {request.passwordLabel}
                </FieldLabel>
                <Input
                  id="confirm-password"
                  type="password"
                  autoComplete="new-password"
                  aria-invalid={error ? true : undefined}
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value)
                    setError(null)
                  }}
                />
                {error ? <FieldError>{error}</FieldError> : null}
              </Field>
            ) : null}

            <AlertDialogFooter>
              <AlertDialogCancel
                render={<Button variant="outline" type="button" />}
              >
                Cancel
              </AlertDialogCancel>
              <Button
                type="submit"
                variant={request?.danger ? "destructive" : "default"}
              >
                {request?.okLabel ?? "OK"}
              </Button>
            </AlertDialogFooter>
          </form>
        </AlertDialogContent>
      </AlertDialog>
    </ConfirmContext.Provider>
  )
}

export function useConfirm() {
  const ctx = React.useContext(ConfirmContext)
  if (!ctx) throw new Error("useConfirm must be used within a ConfirmProvider")
  return ctx
}
