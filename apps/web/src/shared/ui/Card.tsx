import type { ReactNode } from "react";
import { match, P } from "ts-pattern";

export const Card = ({
  children,
  className = "",
}: Readonly<{ children: ReactNode; className?: string }>) => (
  <div
    className={["rounded-[--radius-card] border border-line bg-surface", className].join(
      " ",
    )}
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
      .with(P.string.select(), (text) => <p className="text-sm text-ink-soft">{text}</p>)
      .otherwise(() => null)}
  </header>
);

export const Skeleton = ({ className = "" }: Readonly<{ className?: string }>) => (
  <div className={`animate-pulse rounded-md bg-sunken ${className}`} />
);
