import type { ReactNode } from "react";

/** A bordered panel, which is the shop's one container. */
export const Card = ({
  children,
  className = "",
}: Readonly<{ children: ReactNode; className?: string }>) => (
  <div
    className={["rounded-lg border border-line bg-surface", className].join(
      " ",
    )}
  >
    {children}
  </div>
);
