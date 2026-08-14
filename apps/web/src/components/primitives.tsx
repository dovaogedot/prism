/**
 * The small vocabulary every page is built from.
 *
 * Per CLAUDE.md, conditional rendering inside JSX goes through ts-pattern
 * rather than nested ternaries.
 */

import { Option, type ValidationIssue } from "@hue/shared";
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";
import { forwardRef } from "react";
import { match, P } from "ts-pattern";

/* ------------------------------------------------------------------ button */

type ButtonTone = "accent" | "quiet" | "ghost" | "danger";

const BUTTON_TONES: Record<ButtonTone, string> = {
  accent:
    "bg-accent text-accent-ink hover:bg-accent-hover active:scale-[.98] shadow-sm",
  quiet:
    "bg-sunken text-ink border border-line hover:border-line-strong active:scale-[.98]",
  ghost: "text-ink-soft hover:text-ink hover:bg-sunken",
  danger: "bg-danger text-white hover:opacity-90 active:scale-[.98]",
};

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  Readonly<{ tone?: ButtonTone; busy?: boolean }>;

export const Button = ({
  tone = "accent",
  busy = false,
  className = "",
  children,
  disabled,
  ...rest
}: ButtonProps) => (
  <button
    {...rest}
    disabled={disabled === true || busy}
    // aria-busy rather than swapping the label: a screen reader should not
    // lose the button's name while it works.
    aria-busy={busy}
    className={[
      "inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5",
      "text-sm font-semibold transition-all duration-150",
      "disabled:pointer-events-none disabled:opacity-55",
      BUTTON_TONES[tone],
      className,
    ].join(" ")}
  >
    {match(busy)
      .with(true, () => <Spinner />)
      .with(false, () => null)
      .exhaustive()}
    {children}
  </button>
);

export const Spinner = () => (
  <span
    aria-hidden="true"
    className="size-4 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent"
  />
);

/* ------------------------------------------------------------------- field */

/**
 * `| undefined` is explicit because `exactOptionalPropertyTypes` is on and
 * react-hook-form hands over `errors.field?.message` as `string | undefined`.
 * Omitting it would force every call site to strip undefined by hand.
 */
export type FieldProps = InputHTMLAttributes<HTMLInputElement> &
  Readonly<{
    label: string;
    hint?: string | undefined;
    error?: string | undefined;
  }>;

export const Field = forwardRef<HTMLInputElement, FieldProps>(
  ({ label, hint, error, id, className = "", ...rest }, ref) => {
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
          ref={ref}
          aria-invalid={error !== undefined}
          aria-describedby={describedBy.length === 0 ? undefined : describedBy.join(" ")}
          className={[
            "w-full rounded-lg border bg-surface px-3 py-2.5 text-sm text-ink",
            "placeholder:text-ink-faint transition-colors",
            error === undefined
              ? "border-line hover:border-line-strong"
              : "border-danger",
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
  },
);

Field.displayName = "Field";

/* ------------------------------------------------------------------ alerts */

export type AlertProps = Readonly<{
  tone?: "danger" | "accent";
  title?: string;
  children: ReactNode;
}>;

export const Alert = ({ tone = "danger", title, children }: AlertProps) => (
  <div
    role="alert"
    className={[
      "rounded-lg border px-4 py-3 text-sm",
      tone === "danger"
        ? "border-danger/30 bg-danger-wash text-ink"
        : "border-accent/30 bg-accent-wash text-ink",
    ].join(" ")}
  >
    {match(title)
      .with(P.string.select(), (heading) => (
        <p className="mb-0.5 font-semibold">{heading}</p>
      ))
      .otherwise(() => null)}
    <div className="text-ink-soft">{children}</div>
  </div>
);

/** Field-level messages the server produced, for anything the client missed. */
export const IssueList = ({ issues }: Readonly<{ issues: readonly ValidationIssue[] }>) =>
  match(issues.length)
    .with(0, () => null)
    .otherwise(() => (
      <ul className="list-inside list-disc space-y-0.5">
        {issues.map((issue) => (
          <li key={`${issue.path}:${issue.message}`}>
            {issue.path.length > 0 ? `${issue.path}: ` : ""}
            {issue.message}
          </li>
        ))}
      </ul>
    ));

/* ------------------------------------------------------------------- misc */

export const Card = ({
  children,
  className = "",
}: Readonly<{ children: ReactNode; className?: string }>) => (
  <div
    className={[
      "rounded-[--radius-card] border border-line bg-surface",
      className,
    ].join(" ")}
  >
    {children}
  </div>
);

export const PageHeading = ({
  title,
  lede,
}: Readonly<{ title: string; lede?: string }>) => (
  <header className="space-y-2">
    <h1 className="text-2xl font-semibold tracking-tight text-ink">{title}</h1>
    {match(lede)
      .with(P.string.select(), (text) => (
        <p className="text-sm text-ink-soft">{text}</p>
      ))
      .otherwise(() => null)}
  </header>
);

/** Five stars, filled to the average. Decorative — the label carries the value. */
export const Stars = ({
  rating,
  count,
}: Readonly<{ rating: number; count: number }>) => (
  <span
    className="inline-flex items-center gap-1"
    title={`${rating.toFixed(1)} out of 5 from ${count} review${count === 1 ? "" : "s"}`}
  >
    <span aria-hidden="true" className="inline-flex">
      {[0, 1, 2, 3, 4].map((index) => (
        <svg key={index} viewBox="0 0 20 20" className="size-3.5">
          <defs>
            <linearGradient id={`star-${index}-${Math.round(rating * 10)}`}>
              <stop
                offset={`${Math.max(0, Math.min(1, rating - index)) * 100}%`}
                stopColor="var(--color-accent)"
              />
              <stop offset="0%" stopColor="var(--color-line-strong)" />
            </linearGradient>
          </defs>
          <path
            fill={`url(#star-${index}-${Math.round(rating * 10)})`}
            d="M10 1.5l2.6 5.3 5.9.9-4.2 4.1 1 5.8L10 14.9 4.7 17.6l1-5.8L1.5 7.7l5.9-.9z"
          />
        </svg>
      ))}
    </span>
    <span className="text-xs text-ink-faint">
      {match(count)
        .with(0, () => "No reviews")
        .otherwise(() => `${rating.toFixed(1)} (${count})`)}
    </span>
  </span>
);

export const Skeleton = ({ className = "" }: Readonly<{ className?: string }>) => (
  <div className={`animate-pulse rounded-md bg-sunken ${className}`} />
);

/** Renders an `Option` without the caller writing a branch. */
export const WhenSome = <A,>({
  option,
  children,
}: Readonly<{ option: Option<A>; children: (value: A) => ReactNode }>) =>
  match(option)
    .with({ _tag: "Some" }, ({ value }) => children(value))
    .with({ _tag: "None" }, () => null)
    .exhaustive();
