import { toast } from "@/components/ui/toast"

/** Short confirmation of something that just happened. */
export const notify = (title: string) => toast.add({ title })

export const notifyError = (title: string) =>
  toast.add({ title, type: "error" })
