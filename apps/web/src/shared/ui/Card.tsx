import type { ReactNode } from "react";

/** A bordered panel, which is the shop's one container. */
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

/** A block standing where content will be, sized entirely by its class. */
export const Skeleton = ({ className = "" }: Readonly<{ className?: string }>) => (
  <div className={`animate-pulse rounded-md bg-sunken ${className}`} />
);
