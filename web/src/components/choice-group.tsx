import { cn } from "cn"

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"

export interface Choice {
  value: number
  label: string
}

/**
 * A segmented control over a small set of coded values — the shape every
 * categorical model input takes. Selecting the active item does not clear it,
 * because the model needs a value for each one.
 */
export function ChoiceGroup({
  choices,
  value,
  onChange,
  invalid,
  className,
  ariaLabelledBy,
}: {
  choices: Choice[]
  value: number | null
  onChange: (value: number) => void
  invalid?: boolean
  className?: string
  ariaLabelledBy?: string
}) {
  return (
    <ToggleGroup
      variant="outline"
      size="lg"
      spacing={0}
      value={value === null ? [] : [String(value)]}
      onValueChange={(next: string[]) => {
        if (next.length) onChange(Number(next[0]))
      }}
      aria-labelledby={ariaLabelledBy}
      aria-invalid={invalid || undefined}
      className={cn(
        "w-fit max-w-full flex-wrap",
        invalid && "ring-[3px] ring-destructive/20",
        className
      )}
    >
      {choices.map((choice) => (
        <ToggleGroupItem
          key={choice.value}
          value={String(choice.value)}
          className="aria-pressed:bg-primary aria-pressed:text-primary-foreground aria-pressed:hover:bg-primary"
        >
          {choice.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}
