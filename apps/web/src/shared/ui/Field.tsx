import type { ComponentProps } from "react";
import { match, P } from "ts-pattern";

/**
 * `| undefined` is explicit because `exactOptionalPropertyTypes` is on and
 * react-hook-form hands over `errors.field?.message` as `string | undefined`.
 */
export type FieldProps = ComponentProps<"input"> &
  Readonly<{
    label: string;
    hint?: string | undefined;
    error?: string | undefined;
  }>;

/** A labelled input, with its hint and error tied to it for a screen reader. */
export const Field = ({ label, hint, error, id, className = "", ...rest }: FieldProps) => {
  const fieldId = id ?? rest.name ?? label.toLowerCase().replace(/\s+/g, "-");
  const describedBy = [
    hint === undefined ? null : `${fieldId}-hint`,
    error === undefined ? null : `${fieldId}-error`,
  ].filter((value): value is string => value !== null);

  return (
    <div className="space-y-1.5">
      <label htmlFor={fieldId} className="block text-sm font-medium text-ink">
        {label}
      </label>

      <input
        {...rest}
        id={fieldId}
        aria-invalid={error !== undefined}
        aria-describedby={describedBy.length === 0 ? undefined : describedBy.join(" ")}
        className={[
          "w-full rounded-lg border bg-surface px-3 py-2.5 text-sm text-ink",
          "placeholder:text-ink-faint transition-colors",
          error === undefined ? "border-line hover:border-line-strong" : "border-danger",
          className,
        ].join(" ")}
      />

      {match({ hint, error })
        .with({ error: P.string.select() }, (message) => (
          <p id={`${fieldId}-error`} role="alert" className="text-sm text-danger">
            {message}
          </p>
        ))
        .with({ hint: P.string.select() }, (message) => (
          <p id={`${fieldId}-hint`} className="text-sm text-ink-faint">
            {message}
          </p>
        ))
        .otherwise(() => null)}
    </div>
  );
};
