/**
 * Every database statement the cart makes. Prices and stock are always read
 * from the product, so a cart shows today's price and today's stock.
 */

import { Cart, Pricing, type CartLine, type CartView, type ProductId, type ProductImage, type UserId } from "@prism/shared";
import { and, asc, eq, gt, inArray, isNull, lt, sql } from "drizzle-orm";
import type { Database } from "../../db/client.ts";
import type { CartId } from "../../db/ids.ts";
import { cartItems, carts, products } from "../../db/schema.ts";
import type { Digest } from "../../platform/tokens.ts";

/** A product as the cart checks it before changing a line. */
export type StockedProduct = Readonly<{ id: ProductId; stock: number }>;

/** Every read and write the cart makes against the database. */
export type CartRepository = Readonly<{
  findByUser: (userId: UserId) => Promise<CartId | undefined>;
  /** A guest cart whose cookie digest matches and which has not expired. */
  findByToken: (digest: Digest, now: Date) => Promise<CartId | undefined>;
  /** The user's cart, created if they have none. */
  ensureForUser: (userId: UserId) => Promise<CartId>;
  createForGuest: (digest: Digest, expiresAt: Date) => Promise<CartId>;
  /** Pushes a guest cart's expiry out. */
  extendGuest: (cartId: CartId, expiresAt: Date) => Promise<void>;
  findProduct: (productId: ProductId) => Promise<StockedProduct | undefined>;
  /** How many of a product the cart holds, 0 when it holds none. */
  quantityOf: (cartId: CartId, productId: ProductId) => Promise<number>;
  /** Puts a line at `quantity`, adding it if absent. */
  setQuantity: (cartId: CartId, productId: ProductId, quantity: number) => Promise<void>;
  removeItem: (cartId: CartId, productId: ProductId) => Promise<void>;
  /** Removes every line. */
  empty: (cartId: CartId) => Promise<void>;
  /**
   * Moves every line of the guest cart into the user cart with `Cart.merge`
   * and deletes the guest cart, as one transaction. A guest cart that a
   * concurrent request already merged is skipped.
   */
  merge: (guestCartId: CartId, userCartId: CartId) => Promise<void>;
  view: (cartId: CartId) => Promise<CartView>;
  /** Deletes guest carts that expired before `now`. Resolves to how many. */
  deleteExpired: (now: Date) => Promise<number>;
}>;

export const CartRepository = {
  /** A cart that does not exist yet reads as this. */
  EMPTY: { lines: [], itemCount: 0, subtotalCents: 0 } satisfies CartView,

  /** Lines as the view serves them, with the totals derived by the shared rules. */
  toView: (lines: readonly CartLine[]): CartView => ({
    lines,
    itemCount: lines.reduce((sum, line) => sum + line.quantity, 0),
    subtotalCents: Pricing.subtotal(lines),
  }),

  create: (db: Database): CartRepository => ({
    findByUser: async (userId) => {
      const [row] = await db.select({ id: carts.id }).from(carts).where(eq(carts.userId, userId)).limit(1);
      return row?.id;
    },

    findByToken: async (digest, now) => {
      const [row] = await db
        .select({ id: carts.id })
        .from(carts)
        .where(and(eq(carts.tokenHash, digest), gt(carts.expiresAt, now)))
        .limit(1);
      return row?.id;
    },

    // The unique index decides a race between two first writes: the loser reads the winner's row.
    ensureForUser: async (userId) => {
      const [created] = await db
        .insert(carts)
        .values({ userId })
        .onConflictDoNothing({ target: carts.userId })
        .returning({ id: carts.id });

      if (created !== undefined) return created.id;

      const [existing] = await db.select({ id: carts.id }).from(carts).where(eq(carts.userId, userId)).limit(1);
      if (existing === undefined) throw new Error("user cart vanished between insert and select");

      return existing.id;
    },

    createForGuest: async (digest, expiresAt) => {
      const [created] = await db.insert(carts).values({ tokenHash: digest, expiresAt }).returning({ id: carts.id });
      if (created === undefined) throw new Error("cart insert returned no row");

      return created.id;
    },

    extendGuest: async (cartId, expiresAt) => {
      await db
        .update(carts)
        .set({ expiresAt, updatedAt: sql`now()` })
        .where(and(eq(carts.id, cartId), isNull(carts.userId)));
    },

    findProduct: async (productId) => {
      const [row] = await db
        .select({ id: products.id, stock: products.stock })
        .from(products)
        .where(eq(products.id, productId))
        .limit(1);
      return row;
    },

    quantityOf: async (cartId, productId) => {
      const [row] = await db
        .select({ quantity: cartItems.quantity })
        .from(cartItems)
        .where(and(eq(cartItems.cartId, cartId), eq(cartItems.productId, productId)))
        .limit(1);
      return row?.quantity ?? 0;
    },

    setQuantity: async (cartId, productId, quantity) => {
      await db
        .insert(cartItems)
        .values({ cartId, productId, quantity })
        .onConflictDoUpdate({ target: [cartItems.cartId, cartItems.productId], set: { quantity } });
    },

    removeItem: async (cartId, productId) => {
      await db.delete(cartItems).where(and(eq(cartItems.cartId, cartId), eq(cartItems.productId, productId)));
    },

    empty: async (cartId) => {
      await db.delete(cartItems).where(eq(cartItems.cartId, cartId));
    },

    merge: (guestCartId, userCartId) =>
      db.transaction(async (tx) => {
        // A second request merging the same guest cart waits here, then finds it gone.
        const [guest] = await tx.select({ id: carts.id }).from(carts).where(eq(carts.id, guestCartId)).for("update");
        if (guest === undefined) return;

        const guestLines = await tx
          .select({ productId: cartItems.productId, quantity: cartItems.quantity, stock: products.stock })
          .from(cartItems)
          .innerJoin(products, eq(products.id, cartItems.productId))
          .where(eq(cartItems.cartId, guestCartId));

        const productIds = guestLines.map((line) => line.productId);
        const userLines =
          productIds.length === 0
            ? []
            : await tx
                .select({ productId: cartItems.productId, quantity: cartItems.quantity })
                .from(cartItems)
                .where(and(eq(cartItems.cartId, userCartId), inArray(cartItems.productId, productIds)));
        const userQuantities = new Map(userLines.map((line) => [line.productId, line.quantity]));

        for (const line of guestLines) {
          const quantity = Cart.merge(line.quantity, userQuantities.get(line.productId) ?? 0, line.stock);

          await tx
            .insert(cartItems)
            .values({ cartId: userCartId, productId: line.productId, quantity })
            .onConflictDoUpdate({ target: [cartItems.cartId, cartItems.productId], set: { quantity } });
        }

        await tx.delete(carts).where(eq(carts.id, guestCartId));
      }),

    view: async (cartId) => {
      const rows = await db
        .select({
          productId: cartItems.productId,
          slug: products.slug,
          name: products.name,
          unitPriceCents: products.priceCents,
          stock: products.stock,
          quantity: cartItems.quantity,
          image: sql<ProductImage | null>`(
            SELECT json_build_object('url', '/media/' || i.file, 'alt', i.alt)
            FROM product_image i WHERE i.product_id = ${products.id}
            ORDER BY i.position LIMIT 1
          )`,
        })
        .from(cartItems)
        .innerJoin(products, eq(products.id, cartItems.productId))
        .where(eq(cartItems.cartId, cartId))
        .orderBy(asc(cartItems.addedAt), asc(products.name));

      return CartRepository.toView(
        rows.map(
          (row): CartLine => ({
            productId: row.productId,
            slug: row.slug,
            name: row.name,
            ...(row.image === null ? {} : { image: row.image }),
            unitPriceCents: row.unitPriceCents,
            quantity: row.quantity,
            stock: row.stock,
            lineTotalCents: Pricing.lineTotal(row),
          }),
        ),
      );
    },

    deleteExpired: async (now) => {
      const deleted = await db
        .delete(carts)
        .where(and(isNull(carts.userId), lt(carts.expiresAt, now)))
        .returning({ id: carts.id });
      return deleted.length;
    },
  }),
} as const;
