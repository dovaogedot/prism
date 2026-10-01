/**
 * Every database statement the order service makes. The contact, the
 * address and a guest's key are sealed on the way in and opened on the way
 * out. Every status change is one conditional UPDATE, so a duplicate message
 * or a second housekeeping pass changes nothing.
 */

import {
  Cart,
  Contact,
  OrderKey,
  OrderStatus,
  ShippingAddress,
  type OrderEvent,
  type OrderId,
  type OrderLine,
  type OrderList,
  type OrderNumber,
  type OrderSort,
  type ProductId,
  type ProductImage,
  type ShippingMethod,
  type Totals,
  type UserId,
  type ValidationIssue,
} from "@prism/shared";
import { and, asc, count, desc, eq, gte, inArray, isNull, lt, lte, sql, TransactionRollbackError } from "drizzle-orm";
import type { Database, Transaction } from "../../db/client.ts";
import type { CartId } from "../../db/ids.ts";
import { cartItems, orderEvents, orderLines, orders, products } from "../../db/schema.ts";
import { Outbox, type OutboxEntry } from "../../messaging/outbox.ts";
import type { FieldCipher } from "../../platform/cipher.ts";

/** An order, opened. */
export type OrderRecord = Readonly<{
  id: OrderId;
  number: OrderNumber;
  /** Absent for a guest's order. */
  userId?: UserId;
  cartId?: CartId;
  status: OrderStatus;
  shippingMethod: ShippingMethod;
  subtotalCents: number;
  shippingCents: number;
  totalCents: number;
  contact: Contact;
  address: ShippingAddress;
  /** Present for a guest's order. */
  key?: OrderKey;
  trackingNumber?: string;
  refundedAt?: Date;
  paymentDueAt: Date;
  createdAt: Date;
  /** Ordered by product name. */
  lines: readonly OrderLine[];
}>;

/** One line to reserve, at the price the customer saw. */
export type ReservedLine = Readonly<{ productId: ProductId; quantity: number; unitPriceCents: number }>;

/** Everything a new order is made of. */
export type PlaceRequest = Readonly<{
  cartId: CartId;
  userId?: UserId;
  contact: Contact;
  address: ShippingAddress;
  shippingMethod: ShippingMethod;
  lines: readonly ReservedLine[];
  totals: Totals;
  key?: OrderKey;
  now: Date;
  paymentDueAt: Date;
}>;

/** What placing found. Nothing is written unless the order was placed. */
export type PlaceOutcome =
  | Readonly<{ _tag: "Placed"; orderId: OrderId; number: OrderNumber }>
  | Readonly<{ _tag: "Short"; issues: readonly ValidationIssue[] }>
  | Readonly<{ _tag: "PriceChanged" }>;

/** One conditional move of an order, with everything that has to commit with it. */
export type OrderTransition = Readonly<{
  orderId: OrderId;
  from: readonly OrderStatus[];
  to: OrderStatus;
  /** Shown in the timeline beside the status. */
  note?: string;
  now: Date;
  /** Gives every line's quantity back to its product. */
  releaseStock?: boolean;
  /** Takes the ordered products out of the cart the order came from. */
  clearFromCart?: boolean;
  trackingNumber?: string;
  message?: OutboxEntry;
}>;

/** The filters of a list, already parsed. Both days are whole UTC days and count. */
export type OrderFilter = Readonly<{
  statuses: readonly OrderStatus[];
  from?: string;
  to?: string;
  sort: OrderSort;
  page: number;
  perPage: number;
}>;

/** Every read and write the order service makes. */
export type OrderRepository = Readonly<{
  /**
   * Reserves every line and writes the order, its lines and its first event
   * as one transaction. Lines are reserved in product id order, so two
   * placements never wait on each other in a cycle.
   */
  place: (request: PlaceRequest) => Promise<PlaceOutcome>;
  find: (orderId: OrderId) => Promise<OrderRecord | undefined>;
  /** The user's most recent order. */
  latestOf: (userId: UserId) => Promise<OrderRecord | undefined>;
  events: (orderId: OrderId) => Promise<readonly OrderEvent[]>;
  list: (userId: UserId, filter: OrderFilter) => Promise<OrderList>;
  /** Resolves to whether the order moved. */
  transition: (transition: OrderTransition) => Promise<boolean>;
  /** Records the refund once; resolves to whether this call recorded it. */
  markRefunded: (orderId: OrderId, now: Date) => Promise<boolean>;
  /** Writes one message to the outbox on its own. */
  announce: (entry: OutboxEntry) => Promise<void>;
  /** Unpaid orders whose payment window closed at or before `now`. */
  overdue: (now: Date) => Promise<readonly OrderId[]>;
  /** Orders that have had `status` since `before` or longer. */
  stale: (status: OrderStatus, before: Date) => Promise<readonly OrderId[]>;
}>;

export const OrderRepository = {
  REFUND_NOTE: "Refund issued",

  create: (db: Database, cipher: FieldCipher): OrderRepository => {
    type Row = typeof orders.$inferSelect;

    // The outer row is named as the table plus a literal column: drizzle
    // renders a column bare in a single-table select, where the subquery
    // would read it as its own.
    const lineImage = sql<ProductImage | null>`(
      SELECT json_build_object('url', '/media/' || i.file, 'alt', i.alt)
      FROM product_image i WHERE i.product_id = ${orderLines}."product_id"
      ORDER BY i.position LIMIT 1
    )`;

    const linesOf = async (orderId: OrderId): Promise<readonly OrderLine[]> => {
      const rows = await db
        .select({
          productId: orderLines.productId,
          slug: orderLines.productSlug,
          name: orderLines.productName,
          unitPriceCents: orderLines.unitPriceCents,
          quantity: orderLines.quantity,
          lineTotalCents: orderLines.lineTotalCents,
          image: lineImage,
        })
        .from(orderLines)
        .where(eq(orderLines.orderId, orderId))
        .orderBy(asc(orderLines.productName));

      return rows.map((row) => ({
        ...(row.productId === null ? {} : { productId: row.productId }),
        slug: row.slug,
        name: row.name,
        ...(row.image === null ? {} : { image: row.image }),
        unitPriceCents: row.unitPriceCents,
        quantity: row.quantity,
        lineTotalCents: row.lineTotalCents,
      }));
    };

    const open = async (row: Row): Promise<OrderRecord> => ({
      id: row.id,
      number: row.number,
      ...(row.userId === null ? {} : { userId: row.userId }),
      ...(row.cartId === null ? {} : { cartId: row.cartId }),
      status: row.status,
      shippingMethod: row.shippingMethod,
      subtotalCents: row.subtotalCents,
      shippingCents: row.shippingCents,
      totalCents: row.totalCents,
      contact: cipher.open(row.contact, Contact.schema),
      address: cipher.open(row.shippingAddress, ShippingAddress.schema),
      ...(row.accessKey === null ? {} : { key: cipher.open(row.accessKey, OrderKey.schema) }),
      ...(row.trackingNumber === null ? {} : { trackingNumber: row.trackingNumber }),
      ...(row.refundedAt === null ? {} : { refundedAt: row.refundedAt }),
      paymentDueAt: row.paymentDueAt,
      createdAt: row.createdAt,
      lines: await linesOf(row.id),
    });

    /** Gives every line back to its product, in product id order like the reservation. */
    const release = async (tx: Transaction, orderId: OrderId): Promise<void> => {
      const lines = await tx
        .select({ productId: orderLines.productId, quantity: orderLines.quantity })
        .from(orderLines)
        .where(eq(orderLines.orderId, orderId))
        .orderBy(asc(orderLines.productId));

      for (const line of lines) {
        if (line.productId === null) continue;

        await tx
          .update(products)
          .set({ stock: sql`${products.stock} + ${line.quantity}` })
          .where(eq(products.id, line.productId));
      }
    };

    return {
      place: async (request) => {
        // Set just before the rollback, so the catch below knows why it happened.
        let refusal: PlaceOutcome | undefined;

        try {
          return await db.transaction(async (tx): Promise<PlaceOutcome> => {
            const lines = [...request.lines].sort((a, b) => a.productId.localeCompare(b.productId));
            const issues: ValidationIssue[] = [];
            let priceChanged = false;

            for (const line of lines) {
              // Taking the stock and checking it are one statement: of two
              // placements racing for the last unit, the second waits for the
              // first, re-reads the row, and finds it short.
              const [reserved] = await tx
                .update(products)
                .set({ stock: sql`${products.stock} - ${line.quantity}` })
                .where(and(eq(products.id, line.productId), gte(products.stock, line.quantity)))
                .returning({ priceCents: products.priceCents });

              if (reserved === undefined) {
                const [current] = await tx
                  .select({ stock: products.stock })
                  .from(products)
                  .where(eq(products.id, line.productId));
                issues.push({ path: line.productId, message: Cart.shortage(current?.stock ?? 0) });
              } else if (reserved.priceCents !== line.unitPriceCents) {
                priceChanged = true;
              }
            }

            if (issues.length > 0) {
              refusal = { _tag: "Short", issues };
              tx.rollback();
            }

            if (priceChanged) {
              refusal = { _tag: "PriceChanged" };
              tx.rollback();
            }

            const [order] = await tx
              .insert(orders)
              .values({
                ...(request.userId === undefined ? {} : { userId: request.userId }),
                cartId: request.cartId,
                status: "pending_payment",
                shippingMethod: request.shippingMethod,
                subtotalCents: request.totals.subtotalCents,
                shippingCents: request.totals.shippingCents,
                totalCents: request.totals.totalCents,
                contact: cipher.seal(request.contact),
                shippingAddress: cipher.seal(request.address),
                ...(request.key === undefined ? {} : { accessKey: cipher.seal(request.key) }),
                paymentDueAt: request.paymentDueAt,
                createdAt: request.now,
                statusChangedAt: request.now,
              })
              .returning({ id: orders.id, number: orders.number });
            if (order === undefined) throw new Error("order insert returned no row");

            const names = await tx
              .select({ id: products.id, name: products.name, slug: products.slug })
              .from(products)
              .where(
                inArray(
                  products.id,
                  lines.map((line) => line.productId),
                ),
              );
            const byId = new Map(names.map((product) => [product.id, product]));

            await tx.insert(orderLines).values(
              lines.map((line) => {
                const product = byId.get(line.productId);
                if (product === undefined) throw new Error("a reserved product vanished");

                return {
                  orderId: order.id,
                  productId: line.productId,
                  productName: product.name,
                  productSlug: product.slug,
                  unitPriceCents: line.unitPriceCents,
                  quantity: line.quantity,
                  lineTotalCents: line.unitPriceCents * line.quantity,
                };
              }),
            );

            await tx.insert(orderEvents).values({ orderId: order.id, status: "pending_payment", createdAt: request.now });

            return { _tag: "Placed", orderId: order.id, number: order.number };
          });
        } catch (reason) {
          if (reason instanceof TransactionRollbackError && refusal !== undefined) return refusal;
          throw reason;
        }
      },

      find: async (orderId) => {
        const [row] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
        return row === undefined ? undefined : open(row);
      },

      latestOf: async (userId) => {
        const [row] = await db
          .select()
          .from(orders)
          .where(eq(orders.userId, userId))
          .orderBy(desc(orders.createdAt))
          .limit(1);
        return row === undefined ? undefined : open(row);
      },

      events: async (orderId) => {
        const rows = await db
          .select({ status: orderEvents.status, note: orderEvents.note, at: orderEvents.createdAt })
          .from(orderEvents)
          .where(eq(orderEvents.orderId, orderId))
          .orderBy(asc(orderEvents.createdAt), asc(orderEvents.id));

        return rows.map((row) => ({
          status: row.status,
          ...(row.note === null ? {} : { note: row.note }),
          at: row.at.toISOString(),
        }));
      },

      list: async (userId, filter) => {
        const conditions = and(
          eq(orders.userId, userId),
          filter.statuses.length === 0 ? undefined : inArray(orders.status, [...filter.statuses]),
          filter.from === undefined ? undefined : gte(orders.createdAt, sql`(${filter.from}::date)::timestamp AT TIME ZONE 'UTC'`),
          // The end day counts, so the bound is the start of the next one.
          filter.to === undefined
            ? undefined
            : lt(orders.createdAt, sql`((${filter.to}::date + 1)::timestamp) AT TIME ZONE 'UTC'`),
        );

        const lifecycle = sql`array_position(ARRAY[${sql.join(
          OrderStatus.NAMES.map((name) => sql`${name}`),
          sql`, `,
        )}]::text[], ${orders.status})`;

        const ordering = {
          newest: [desc(orders.createdAt), desc(orders.number)],
          oldest: [asc(orders.createdAt), asc(orders.number)],
          status: [asc(lifecycle), desc(orders.createdAt), desc(orders.number)],
        } as const;

        const rows = await db
          .select({
            id: orders.id,
            number: orders.number,
            status: orders.status,
            createdAt: orders.createdAt,
            totalCents: orders.totalCents,
            itemCount: sql<number>`(SELECT COALESCE(sum(l.quantity), 0)::int FROM order_line l WHERE l.order_id = ${orders}."id")`,
            image: sql<ProductImage | null>`(
              SELECT json_build_object('url', '/media/' || i.file, 'alt', i.alt)
              FROM order_line l JOIN product_image i ON i.product_id = l.product_id
              WHERE l.order_id = ${orders}."id"
              ORDER BY l.product_name, i.position LIMIT 1
            )`,
            total: sql<number>`(count(*) OVER ())::int`,
          })
          .from(orders)
          .where(conditions)
          .orderBy(...ordering[filter.sort])
          .limit(filter.perPage)
          .offset((filter.page - 1) * filter.perPage);

        const total = rows[0]?.total ?? (await db.select({ total: count() }).from(orders).where(conditions))[0]?.total ?? 0;

        return {
          items: rows.map((row) => ({
            id: row.id,
            number: row.number,
            status: row.status,
            createdAt: row.createdAt.toISOString(),
            totalCents: row.totalCents,
            itemCount: row.itemCount,
            ...(row.image === null ? {} : { image: row.image }),
          })),
          total,
          page: filter.page,
          perPage: filter.perPage,
          totalPages: Math.max(1, Math.ceil(total / filter.perPage)),
        };
      },

      transition: (transition) =>
        db.transaction(async (tx) => {
          const [moved] = await tx
            .update(orders)
            .set({
              status: transition.to,
              statusChangedAt: transition.now,
              ...(transition.trackingNumber === undefined ? {} : { trackingNumber: transition.trackingNumber }),
            })
            .where(and(eq(orders.id, transition.orderId), inArray(orders.status, [...transition.from])))
            .returning({ id: orders.id, cartId: orders.cartId });

          if (moved === undefined) return false;

          await tx.insert(orderEvents).values({
            orderId: transition.orderId,
            status: transition.to,
            ...(transition.note === undefined ? {} : { note: transition.note }),
            createdAt: transition.now,
          });

          if (transition.releaseStock === true) await release(tx, transition.orderId);

          if (transition.clearFromCart === true && moved.cartId !== null) {
            await tx
              .delete(cartItems)
              .where(
                and(
                  eq(cartItems.cartId, moved.cartId),
                  inArray(
                    cartItems.productId,
                    tx
                      .select({ productId: sql<ProductId>`${orderLines.productId}` })
                      .from(orderLines)
                      .where(eq(orderLines.orderId, transition.orderId)),
                  ),
                ),
              );
          }

          if (transition.message !== undefined) await Outbox.enqueue(tx, transition.message);

          return true;
        }),

      markRefunded: (orderId, now) =>
        db.transaction(async (tx) => {
          const [marked] = await tx
            .update(orders)
            .set({ refundedAt: now })
            .where(and(eq(orders.id, orderId), isNull(orders.refundedAt)))
            .returning({ status: orders.status });

          if (marked === undefined) return false;

          await tx
            .insert(orderEvents)
            .values({ orderId, status: marked.status, note: OrderRepository.REFUND_NOTE, createdAt: now });

          return true;
        }),

      announce: (entry) => db.transaction((tx) => Outbox.enqueue(tx, entry)),

      overdue: async (now) => {
        const rows = await db
          .select({ id: orders.id })
          .from(orders)
          .where(and(eq(orders.status, "pending_payment"), lte(orders.paymentDueAt, now)));
        return rows.map((row) => row.id);
      },

      stale: async (status, before) => {
        const rows = await db
          .select({ id: orders.id })
          .from(orders)
          .where(and(eq(orders.status, status), lte(orders.statusChangedAt, before)));
        return rows.map((row) => row.id);
      },
    };
  },
} as const;
