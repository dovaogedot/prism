import type { ComponentProps, ReactNode } from "react";

/**
 * `| undefined` is explicit because `exactOptionalPropertyTypes` is on and
 * react-hook-form hands over `errors.field?.message` as `string | undefined`.
 */
export type FieldProps = ComponentProps<"input"> &
  Readonly<{
    label: string;
    hint?: string | undefined;
    error?: string | undefined;
    /** A control in the input's row, after it, such as the button that submits it. */
    action?: ReactNode;
  }>;

/** A labelled input, with its hint and error tied to it for a screen reader. */
export const Field = ({ label, hint, error, action, id, className = "", ...rest }: FieldProps) => {
  const fieldId = id ?? rest.name ?? label.toLowerCase().replace(/\s+/g, "-");
  const describedBy = [
    hint === undefined ? null : `${fieldId}-hint`,
    error === undefined ? null : `${fieldId}-error`,
  ].filter((value): value is string => value !== null);

  const input = (
    <input
      {...rest}
      id={fieldId}
      aria-invalid={error !== undefined}
      aria-describedby={describedBy.length === 0 ? undefined : describedBy.join(" ")}
      className={[
        "w-full min-w-0 rounded-lg border bg-surface px-3 py-2.5 text-sm text-ink",
        "placeholder:text-ink-faint transition-colors",
        error === undefined ? "border-edge hover:border-ink-faint" : "border-danger",
        className,
      ].join(" ")}
    />
  );

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
  );
};
