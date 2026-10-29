import type { ValidationIssue } from "@prism/shared"
import { match } from "ts-pattern"

/** The issues to list. */
export type IssueListProps = Readonly<{ issues: readonly ValidationIssue[] }>

/** Field-level messages the server produced, for anything the client missed. */
export const IssueList = ({ issues }: IssueListProps) =>
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
    ))
