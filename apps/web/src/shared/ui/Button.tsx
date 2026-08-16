import type { ButtonHTMLAttributes } from "react";
import { match } from "ts-pattern";
import { Spinner } from "./Spinner.tsx";

export type ButtonTone = "accent" | "quiet" | "ghost" | "danger";

const TONES: Record<ButtonTone, string> = {
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
      TONES[tone],
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
