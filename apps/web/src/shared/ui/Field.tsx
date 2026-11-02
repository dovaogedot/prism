import type { ComponentProps, ReactNode } from "react"

/**
 * `| undefined` is explicit because `exactOptionalPropertyTypes` is on and
 * react-hook-form hands over `errors.field?.message` as `string | undefined`.
 */
export type FieldProps = ComponentProps<"input"> &
  Readonly<{
    label: string
    hint?: string | undefined
    error?: string | undefined
    /** A control in the input's row, after it, such as the button that submits it. */
    action?: ReactNode
    /** Drawn inside the input, before the text, such as a phone number's flag. */
    leading?: ReactNode
  }>

/** A labeled input, with its hint and error tied to it for a screen reader. */
export const Field = ({ label, hint, error, action, leading, id, className = "", ...rest }: FieldProps) => {
  const fieldId = id ?? rest.name ?? label.toLowerCase().replace(/\s+/g, "-")
  const describedBy = [hint === undefined ? null : `${fieldId}-hint`, error === undefined ? null : `${fieldId}-error`].filter(
    (value): value is string => value !== null,
  )

  const field = (
    <input
      {...rest}
      id={fieldId}
      aria-invalid={error !== undefined}
      aria-describedby={describedBy.length === 0 ? undefined : describedBy.join(" ")}
      className={[
        "w-full min-w-0 rounded-lg border bg-surface py-2.5 pr-3 text-sm text-ink",
        leading === undefined ? "pl-3" : "pl-10",
        "placeholder:text-ink-faint transition-colors",
        error === undefined ? "border-edge hover:border-ink-faint" : "border-danger",
        className,
      ].join(" ")}
    />
  )

  const input =
    leading === undefined ? (
      field
    ) : (
      <div className="relative">
        <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center">{leading}</span>
        {field}
      </div>
    )

  return (
    <div className="space-y-1.5">
      <label htmlFor={fieldId} className="block text-sm font-medium text-ink">
        {label}
      </label>

      {action === undefined ? (
        input
      ) : (
        <div className="flex items-center gap-3">
          {input}
          <div className="shrink-0">{action}</div>
        </div>
      )}

      {hint === undefined ? null : (
        <p className="text-sm text-ink-faint" id={`${fieldId}-hint`}>
          {hint}
        </p>
      )}
      {error === undefined ? null : (
        <p className="text-sm text-danger" id={`${fieldId}-error`} role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
