/**
 * Money is integer cents everywhere. Floating-point euros in a price column is
 * how a shop ends up charging €19.989999999999998.
 */

import type { Brand } from "../fp/brand.ts";
import { Option } from "../fp/option.ts";

export type Cents = Brand<number, "Cents">;

export const CURRENCY = "EUR";

export const isCents = (value: number): value is Cents =>
  Number.isSafeInteger(value) && value >= 0;

export const parseCents = (value: number): Option<Cents> =>
  isCents(value) ? Option.some(value) : Option.none;

/** `1999 -> "19.99"`. Presentation only; never round-trips back into storage. */
export const formatAmount = (cents: Cents): string =>
  (cents / 100).toFixed(2);

export const formatPrice = (cents: Cents, locale = "en-IE"): string =>
  new Intl.NumberFormat(locale, {
    style: "currency",
    currency: CURRENCY,
  }).format(cents / 100);
