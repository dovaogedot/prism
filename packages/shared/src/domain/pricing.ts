/**
 * What an order costs. The API charges with these functions and the browser
 * shows totals with the same ones, so the two cannot disagree. Every amount
 * is in whole cents, so no sum rounds.
 */

import { ShippingMethod } from "../contracts/checkout.ts";

/** What a line costs before shipping. */
export type PricedLine = Readonly<{ unitPriceCents: number; quantity: number }>;

/** The three figures of an order summary. */
export type Totals = Readonly<{ subtotalCents: number; shippingCents: number; totalCents: number }>;

export const Pricing = {
  lineTotal: (line: PricedLine): number => line.unitPriceCents * line.quantity,

  subtotal: (lines: readonly PricedLine[]): number =>
    lines.reduce((sum, line) => sum + Pricing.lineTotal(line), 0),

  /** A method with a free-from threshold ships free once the subtotal reaches it. */
  shipping: (method: ShippingMethod, subtotalCents: number): number => {
    const freeFrom = ShippingMethod.freeFromCents[method];

    return freeFrom !== undefined && subtotalCents >= freeFrom ? 0 : ShippingMethod.priceCents[method];
  },

  totals: (lines: readonly PricedLine[], method: ShippingMethod): Totals => {
    const subtotalCents = Pricing.subtotal(lines);
    const shippingCents = Pricing.shipping(method, subtotalCents);

    return { subtotalCents, shippingCents, totalCents: subtotalCents + shippingCents };
  },
} as const;
