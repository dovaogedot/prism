/**
 * What a Postgres error says, read from the driver's error or one level down
 * from drizzle's wrapper around it, so every module reads it the same way.
 */

export const PgError = {
  /** The SQLSTATE code, such as `23505` for a unique violation. */
  codeOf: (reason: unknown): string | undefined => PgError.fieldOf(reason, "code"),

  /** The constraint the error names. */
  constraintOf: (reason: unknown): string | undefined => PgError.fieldOf(reason, "constraint_name"),

  isUniqueViolation: (reason: unknown): boolean => PgError.codeOf(reason) === "23505",

  isForeignKeyViolation: (reason: unknown): boolean => PgError.codeOf(reason) === "23503",

  /** A text field of the error, or of the error it wraps. */
  fieldOf: (reason: unknown, field: "code" | "constraint_name"): string | undefined => {
    const own = (value: unknown): string | undefined => {
      if (typeof value !== "object" || value === null) return undefined

      const found: unknown = Reflect.get(value, field)
      return typeof found === "string" ? found : undefined
    }

    return own(reason) ?? (typeof reason === "object" && reason !== null && "cause" in reason ? own(reason.cause) : undefined)
  },
} as const
