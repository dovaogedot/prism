/**
 * Whole calendar days in the shop's time zone as conditions on a timestamp
 * column, so every date filter and every daily count cuts the same days the
 * pages show their times in.
 */

import { Delivery } from "@prism/shared"
import { gte, lt, sql, type AnyColumn, type SQL } from "drizzle-orm"

export const DayRange = {
  /**
   * That `column` falls on `from` or later, and on `to` or earlier, both
   * `YYYY-MM-DD`; each condition is left out when its day is.
   */
  conditionsOf: (column: AnyColumn, from: string | undefined, to: string | undefined): readonly (SQL | undefined)[] => [
    from === undefined ? undefined : gte(column, sql`(${from}::date)::timestamp AT TIME ZONE ${Delivery.TIME_ZONE}`),
    // The end day counts, so the bound is the start of the next one.
    to === undefined ? undefined : lt(column, sql`((${to}::date + 1)::timestamp) AT TIME ZONE ${Delivery.TIME_ZONE}`),
  ],
} as const
