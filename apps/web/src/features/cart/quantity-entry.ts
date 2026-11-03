/**
 * What a quantity field makes of the text typed into it: the quantity it
 * settles on, and why that is not the number typed when it is not.
 */

import { Cart, Quantity } from "@prism/shared"

/** The quantity a field settles on, and the sentence saying why when it differs from what was typed. */
export type QuantityEntry = Readonly<{ quantity: number; note?: string }>

export const QuantityEntry = {
  /** An entry of `quantity`, with `note` when there is one. */
  create: (quantity: number, note: string | undefined): QuantityEntry => (note === undefined ? { quantity } : { quantity, note }),

  /**
   * The most a field holding `current` of a product with `stock` allows: the
   * stock, or the quantity held when that is more, as on a cart line the
   * stock fell under, and never more than the line limit or less than one.
   */
  findCeiling: (current: number, stock: number): number => Math.max(Quantity.MIN, Math.min(Quantity.MAX, Math.max(current, stock))),

  /**
   * Reads `typed` for a field holding `current` of a product with `stock`. A
   * whole number from 1 to the ceiling stands. One outside goes to the nearer
   * end, and anything else that was typed keeps `current`, each with the
   * reason; an empty field keeps `current` without one.
   */
  read: (typed: string, current: number, stock: number): QuantityEntry => {
    if (typed.trim().length === 0) return { quantity: current }

    const wanted = Number(typed)
    const ceiling = QuantityEntry.findCeiling(current, stock)
    const refusal = Quantity.schema.safeParse(wanted).error?.issues[0]?.message

    if (!Number.isInteger(wanted)) return QuantityEntry.create(current, refusal)
    if (wanted < Quantity.MIN) return QuantityEntry.create(Quantity.MIN, refusal)
    if (wanted <= ceiling) return { quantity: wanted }

    // Past the stock, the stock is the reason, also when the line limit is passed as well.
    return QuantityEntry.create(ceiling, stock < Quantity.MAX ? Cart.shortage(stock) : refusal)
  },
} as const
