/**
 * When a parcel is expected. A delivery window counts business days after
 * the day the order was placed, in the shop's time zone: Saturdays and
 * Sundays do not count, and public holidays do.
 */

/** A delivery window in business days, both ends counted. */
export type DeliveryWindow = Readonly<{ minDays: number; maxDays: number }>;

/** The first and last day a parcel is expected, as `YYYY-MM-DD`. */
export type DeliveryEstimate = Readonly<{ from: string; to: string }>;

export const Delivery = {
  TIME_ZONE: "Europe/Tallinn",

  /** The calendar day `instant` falls on in the shop's time zone, as `YYYY-MM-DD`. */
  dayOf: (instant: Date): string => {
    const parts = new Intl.DateTimeFormat("en", {
      timeZone: Delivery.TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(instant);
    const part = (type: "year" | "month" | "day"): string => parts.find((candidate) => candidate.type === type)?.value ?? "";

    return `${part("year")}-${part("month")}-${part("day")}`;
  },

  /** The day `count` business days after `day`, both as `YYYY-MM-DD`. */
  addBusinessDays: (day: string, count: number): string => {
    const date = new Date(`${day}T00:00:00.000Z`);

    for (let remaining = count; remaining > 0; ) {
      date.setUTCDate(date.getUTCDate() + 1);
      const weekday = date.getUTCDay();
      if (weekday !== 0 && weekday !== 6) remaining -= 1;
    }

    return date.toISOString().slice(0, 10);
  },

  /** The days an order placed at `placedAt` is expected to arrive within. */
  estimate: (placedAt: Date, window: DeliveryWindow): DeliveryEstimate => {
    const day = Delivery.dayOf(placedAt);

    return { from: Delivery.addBusinessDays(day, window.minDays), to: Delivery.addBusinessDays(day, window.maxDays) };
  },
} as const;
