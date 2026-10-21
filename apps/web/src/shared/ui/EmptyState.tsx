import type { ReactNode } from "react";

/** What is missing, what it means, and what to do about it. */
export type EmptyStateProps = Readonly<{
  title: string;
  children?: ReactNode;
  /** A link or button that gets the reader somewhere with content. */
  action?: ReactNode;
}>;

/** Stands where a list would be when the list is empty. */
export const EmptyState = ({ title, children, action }: EmptyStateProps) => (
  <div className="rounded-lg border border-dashed border-line bg-surface px-6 py-14 text-center">
    <p className="font-medium text-ink">{title}</p>
    {children === undefined ? null : <div className="mx-auto mt-1 max-w-md text-sm text-ink-soft">{children}</div>}
    {action === undefined ? null : <div className="mt-4">{action}</div>}
  </div>
);
