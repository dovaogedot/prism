/**
 * What an order costs. The API charges with these functions and the browser
 * shows totals with the same ones, so the two cannot disagree. Every amount
 * is in whole cents, so no sum rounds.
 */

import type { ShippingOption } from "../contracts/checkout.ts";

/** What a line costs before shipping. */
export type PricedLine = Readonly<{ unitPriceCents: number; quantity: number }>;

/** What pricing reads from a delivery option. */
export type PricedOption = Pick<ShippingOption, "priceCents" | "freeFromCents">;

/** The three figures of an order summary. */
export type Totals = Readonly<{ subtotalCents: number; shippingCents: number; totalCents: number }>;

export const Pricing = {
  lineTotal: (line: PricedLine): number => line.unitPriceCents * line.quantity,

  subtotal: (lines: readonly PricedLine[]): number =>
    lines.reduce((sum, line) => sum + Pricing.lineTotal(line), 0),

  /** An option with a free-from threshold ships free once the subtotal reaches it. */
  shipping: (option: PricedOption, subtotalCents: number): number =>
    option.freeFromCents !== undefined && subtotalCents >= option.freeFromCents ? 0 : option.priceCents,

  /** How much more the subtotal needs before `option` ships free; `undefined` when it never does. */
  untilFree: (option: PricedOption, subtotalCents: number): number | undefined =>
    option.freeFromCents === undefined ? undefined : Math.max(0, option.freeFromCents - subtotalCents),

  totals: (lines: readonly PricedLine[], option: PricedOption): Totals => {
    const subtotalCents = Pricing.subtotal(lines);
    const shippingCents = Pricing.shipping(option, subtotalCents);

    return { subtotalCents, shippingCents, totalCents: subtotalCents + shippingCents };
  },
} as const;
