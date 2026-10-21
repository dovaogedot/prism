import type { ComponentProps } from "react";

/** Everything a `<select>` takes, plus its label, hint and error. */
export type SelectFieldProps = ComponentProps<"select"> &
  Readonly<{
    label: string;
    hint?: string | undefined;
    error?: string | undefined;
  }>;

/** A labelled select, with its hint and error tied to it for a screen reader. */
export const SelectField = ({ label, hint, error, id, className = "", children, ...rest }: SelectFieldProps) => {
  const fieldId = id ?? rest.name ?? label.toLowerCase().replace(/\s+/g, "-");
  const describedBy = [hint === undefined ? undefined : `${fieldId}-hint`, error === undefined ? undefined : `${fieldId}-error`].filter(
    (value): value is string => value !== undefined,
  );

  return (
    <div className="space-y-1.5">
      <label className="block text-sm font-medium text-ink" htmlFor={fieldId}>
        {label}
      </label>
      <select
        {...rest}
        className={[
          "w-full rounded-lg border bg-surface px-3 py-2.5 text-sm text-ink transition-colors",
          error === undefined ? "border-line hover:border-line-strong" : "border-danger",
          className,
        ].join(" ")}
        id={fieldId}
        aria-invalid={error !== undefined}
        aria-describedby={describedBy.length === 0 ? undefined : describedBy.join(" ")}
      >
        {children}
      </select>
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
