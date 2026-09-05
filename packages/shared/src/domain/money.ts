/**
 * Money is integer cents everywhere. Floating-point euros in a price column is
 * how a shop ends up charging €19.989999999999998.
 */

import type { Brand } from "../fp/brand.ts";

/** A price as a whole number of cents. Never negative. */
export type Cents = Brand<number, "Cents">;

/** The ISO 4217 code every price in the shop is quoted in. */
export const CURRENCY = "EUR";

/** Whether a number is a safe non-negative integer, and so a valid `Cents`. */
export const isCents = (value: number): value is Cents =>
  Number.isSafeInteger(value) && value >= 0;

/** A price with its currency symbol, placed as `locale` places it. */
export const formatPrice = (cents: Cents, locale = "en-IE"): string =>
  new Intl.NumberFormat(locale, {
    style: "currency",
    currency: CURRENCY,
  }).format(cents / 100);
