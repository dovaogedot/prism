/** Moments and days as the reader's own clock and calendar read them. */
export const DateTime = {
  /** A moment as the customer's own clock reads it, in the day-month order every date in the shop uses. */
  format: (iso: string): string => new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso)),

  /** A calendar day as the customer's own calendar reads it. */
  day: (iso: string): string => new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" }).format(new Date(iso)),
} as const
