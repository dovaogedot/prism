/**
 * The cart as the API serves it and the browser reads it. Every amount is in
 * whole cents of the shop's one currency, VAT included.
 */

import { z } from "zod";
import { ProductId, type ProductImage, type Slug } from "./catalog.ts";

/** How many of one product a cart line holds. */
export const Quantity = {
  MIN: 1,
  MAX: 99,
  schema: z
    .number({ error: "Enter a quantity." })
    .int("Enter a whole number.")
    .min(1, "Enter at least 1.")
    .max(99, "You can order at most 99 of one item."),
} as const;

/** A validated `POST /cart/items` body. */
export type AddToCartInput = z.infer<typeof AddToCartInput.schema>;
export const AddToCartInput = {
  schema: z.strictObject({
    productId: ProductId.schema,
    quantity: Quantity.schema.default(1),
  }),
} as const;

/** A validated `PUT /cart/items/:productId` body. */
export type SetQuantityInput = z.infer<typeof SetQuantityInput.schema>;
export const SetQuantityInput = {
  schema: z.strictObject({ quantity: Quantity.schema }),
} as const;

/** One product in the cart, priced at today's price. */
export type CartLine = Readonly<{
  productId: ProductId;
  slug: Slug;
  name: string;
  /** Left out for a product without pictures. */
  image?: ProductImage;
  unitPriceCents: number;
  quantity: number;
  /** How many the shop has right now, so the page can warn before checkout. */
  stock: number;
  lineTotalCents: number;
}>;

/** The whole cart. An absent cart is served as an empty one. */
export type CartView = Readonly<{
  /** Oldest addition first. */
  lines: readonly CartLine[];
  /** The sum of the quantities. */
  itemCount: number;
  subtotalCents: number;
}>;
