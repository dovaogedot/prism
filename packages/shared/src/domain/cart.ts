/**
 * The rules for changing a cart line, without storage. The API enforces
 * them, and the cart page uses them to warn before the server has to.
 */

import { Quantity } from "../contracts/cart.ts";
import type { ProductId } from "../contracts/catalog.ts";
import type { ValidationIssue } from "./errors.ts";

/** A wanted quantity, as the stock and the line limit allow it. */
export type QuantityCheck =
  | Readonly<{ _tag: "Allowed"; quantity: number }>
  | Readonly<{ _tag: "Short"; message: string }>;

/** What `Cart.issues` reads from a line. */
export type StockedLine = Readonly<{ productId: ProductId; quantity: number; stock: number }>;

export const Cart = {
  /** The sentence for a product that cannot supply what is asked. */
  shortage: (stock: number): string => (stock <= 0 ? "Sold out." : `Only ${stock} left.`),

  /** Setting a line to `quantity`, refused when the shop has fewer. */
  set: (quantity: number, stock: number): QuantityCheck =>
    quantity > stock ? { _tag: "Short", message: Cart.shortage(stock) } : { _tag: "Allowed", quantity },

  /** Adding `adding` to a line that holds `current`, refused past the stock or the line limit. */
  add: (current: number, adding: number, stock: number): QuantityCheck => {
    const wanted = current + adding;

    if (wanted > Quantity.MAX) {
      return { _tag: "Short", message: `You can order at most ${Quantity.MAX} of one item.` };
    }

    return Cart.set(wanted, stock);
  },

  /**
   * One line from a guest cart and a user cart of the same product: the sum,
   * capped at the line limit and the stock, and never below one so the line
   * survives to show its warning.
   */
  merge: (guest: number, user: number, stock: number): number =>
    Math.max(Quantity.MIN, Math.min(guest + user, Quantity.MAX, stock)),

  /** One issue per line the shop cannot supply in full, keyed by product id. */
  issues: (lines: readonly StockedLine[]): readonly ValidationIssue[] =>
    lines
      .filter((line) => line.quantity > line.stock)
      .map((line) => ({ path: line.productId, message: Cart.shortage(line.stock) })),
} as const;
