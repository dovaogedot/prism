/** The days a parcel is expected, in words. */

import type { DeliveryEstimate } from "@prism/shared";

export const DeliveryDates = {
  /** A calendar day as a short date in words, such as "Tue 21 Oct". */
  day: (day: string): string =>
    new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${day}T00:00:00Z`)),

  /** One day, or the first and last day, such as "Tue 21 Oct to Thu 23 Oct". */
  format: (estimate: DeliveryEstimate): string =>
    estimate.from === estimate.to ? DeliveryDates.day(estimate.from) : `${DeliveryDates.day(estimate.from)} to ${DeliveryDates.day(estimate.to)}`,

  /** When the parcel comes, to end a sentence with: "on Tue 21 Oct", or "between Tue 21 Oct and Thu 23 Oct". */
  phrase: (estimate: DeliveryEstimate): string =>
    estimate.from === estimate.to
      ? `on ${DeliveryDates.day(estimate.from)}`
      : `between ${DeliveryDates.day(estimate.from)} and ${DeliveryDates.day(estimate.to)}`,
} as const;
