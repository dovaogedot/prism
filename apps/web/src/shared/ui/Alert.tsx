import type { ValidationIssue } from "@prism/shared";
import type { ReactNode } from "react";
import { match, P } from "ts-pattern";

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
export const IssueList = ({
  issues,
}: Readonly<{ issues: readonly ValidationIssue[] }>) =>
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
