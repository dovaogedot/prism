import type { ReactNode } from "react";
import { match, P } from "ts-pattern";

/** The card every sign-in page sits in: a heading, the form, and a line beneath. */
export const AuthShell = ({
  title,
  lede,
  children,
  footer,
}: Readonly<{
  title: string;
  lede: string;
  children: ReactNode;
  footer?: ReactNode;
}>) => (
  <div className="mx-auto flex min-h-[calc(100dvh-4rem)] max-w-md flex-col justify-center px-4 py-12">
    <div className="mb-6 space-y-1.5">
      <h1 className="text-2xl font-semibold tracking-tight text-ink">{title}</h1>
      <p className="text-sm text-ink-soft">{lede}</p>
    </div>

    <div className="rounded-lg border border-line bg-surface p-6">
      {children}
    </div>

    {match(footer)
      .with(P.nullish, () => null)
      .otherwise((content) => (
        <div className="mt-4 text-center text-sm text-ink-soft">{content}</div>
      ))}
  </div>
);
