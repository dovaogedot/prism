/**
 * Rules over more than one field of a form. Zod runs such a rule only once the
 * whole form parses; a form checked field by field needs it as soon as the
 * fields it reads are valid, whatever the others hold.
 */

import type { z } from "zod"

export const FieldChecks = {
  /** The `when` of a rule that reads `names`: true once none of those fields has an issue. */
  runWhenValid:
    (...names: readonly string[]) =>
    (payload: z.core.ParsePayload): boolean =>
      payload.issues.every((issue) => !names.includes(String(issue.path?.[0]))),
} as const
