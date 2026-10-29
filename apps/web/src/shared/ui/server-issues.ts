import type { ValidationIssue } from "@prism/shared"
import type { FieldValues, Path, UseFormSetError } from "react-hook-form"

export const ServerIssues = {
  /**
   * Puts each issue the server found under the field it names, and hands
   * back the ones no field shows. `renamed` maps the API's names to the
   * form's, such as `priceCents` to `price`.
   */
  place: <Values extends FieldValues>(
    issues: readonly ValidationIssue[],
    fields: readonly string[],
    setError: UseFormSetError<Values>,
    renamed: Readonly<Record<string, string>> = {},
  ): readonly ValidationIssue[] => {
    const unplaced: ValidationIssue[] = []

    for (const issue of issues) {
      const path = renamed[issue.path] ?? issue.path
      const isField = fields.includes(path) || fields.some((field) => path.startsWith(`${field}.`))

      if (isField) {
        setError(path as Path<Values>, { message: issue.message })
      } else {
        unplaced.push(issue)
      }
    }

    return unplaced
  },
} as const
