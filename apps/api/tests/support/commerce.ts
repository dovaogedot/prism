/**
 * Shopping as a test describes it: fill a cart, place an order, and play the
 * webhooks Stripe would send, signed the way Stripe signs them.
 */

import { Pricing, type ShippingMethod } from "@prism/shared";
import { and, eq } from "drizzle-orm";
import { payments, products } from "../../src/db/schema.ts";
import { PaymentGateway } from "../../src/platform/payment-gateway.ts";
import { cookieValue, type Harness } from "./harness.ts";

/** Who is calling: a guest cookie, a bearer token, both, or neither. */
export type Caller = Readonly<{ guest?: string; token?: string }>;

/** A contact and an address every format check accepts. */
export const CHECKOUT = {
  contact: { fullName: "Mari Maasikas", email: "mari@example.com", phone: "+372 5123 4567" },
  address: { line1: "Narva mnt 7", city: "Tallinn", postalCode: "10117", country: "EE" },
} as const;

export const Shop = {
  /** Sends a request as `caller`. */
  call: (
    harness: Harness,
    method: "GET" | "POST" | "PUT" | "DELETE",
    url: string,
    caller: Caller = {},
    payload?: object,
  ) =>
    harness.app.inject({
      method,
      url: `/api/v1${url}`,
      ...(payload === undefined ? {} : { payload }),
      ...(caller.guest === undefined ? {} : { cookies: { prism_cart: caller.guest } }),
      ...(caller.token === undefined ? {} : { headers: { authorization: `Bearer ${caller.token}` } }),
    }),

  productId: async (harness: Harness, slug: string): Promise<string> => {
    const [row] = await harness.database.db
      .select({ id: products.id })
      .from(products)
      .where(eq(products.slug, slug as never));
    if (row === undefined) throw new Error(`no product ${slug}`);
    return row.id;
  },

  stockOf: async (harness: Harness, slug: string): Promise<number> => {
    const [row] = await harness.database.db
      .select({ stock: products.stock })
      .from(products)
      .where(eq(products.slug, slug as never));
    if (row === undefined) throw new Error(`no product ${slug}`);
    return row.stock;
  },

  /**
   * Adds each `[slug, quantity]` to the caller's cart, starting a guest cart
   * when the caller has none. Resolves to the caller, with the guest cookie.
   */
  fill: async (harness: Harness, items: readonly (readonly [string, number])[], caller: Caller = {}): Promise<Caller> => {
    let current = caller;

    for (const [slug, quantity] of items) {
      const response = await Shop.call(harness, "POST", "/cart/items", current, {
        productId: await Shop.productId(harness, slug),
        quantity,
      });
      if (response.statusCode !== 200) throw new Error(`adding ${slug} failed: ${response.body}`);

      const cookie = cookieValue(response, "prism_cart");
      if (cookie.length > 0) current = { ...current, guest: cookie };
    }

    return current;
  },

  /** What the order page would show as the total of the caller's cart. */
  totalOf: async (harness: Harness, caller: Caller, method: ShippingMethod = "standard"): Promise<number> => {
    const view = JSON.parse((await Shop.call(harness, "GET", "/cart", caller)).body) as {
      lines: { unitPriceCents: number; quantity: number }[];
    };
    return Pricing.totals(view.lines, method).totalCents;
  },

  /** Places an order from the caller's cart at the total the cart shows. */
  place: async (harness: Harness, caller: Caller, overrides: Readonly<Record<string, unknown>> = {}) =>
    Shop.call(harness, "POST", "/orders", caller, {
      ...CHECKOUT,
      shippingMethod: "standard",
      expectedTotalCents: await Shop.totalOf(harness, caller),
      ...overrides,
    }),

  /** Places an order and hands back its id, key and charge. Fails the test if placing fails. */
  placed: async (harness: Harness, caller: Caller) => {
    const response = await Shop.place(harness, caller);
    if (response.statusCode !== 201) throw new Error(`placing failed: ${response.body}`);

    const body = JSON.parse(response.body) as { orderId: string; number: number; key?: string; clientSecret: string };
    return { ...body, charge: await Shop.chargeOf(harness, body.orderId) };
  },

  /** The charge row of an order and the intent the fake gateway made for it. */
  chargeOf: async (harness: Harness, orderId: string) => {
    const [row] = await harness.database.db
      .select({ id: payments.id, amountCents: payments.amountCents, status: payments.status })
      .from(payments)
      .where(and(eq(payments.orderId, orderId as never), eq(payments.kind, "charge")));
    if (row === undefined) throw new Error(`order ${orderId} has no charge`);

    return { ...row, intent: harness.gateway.intentOf(row.id) ?? "pi_never_created" };
  },

  /** Delivers one signed webhook. */
  webhook: async (harness: Harness, type: string, object: Readonly<Record<string, unknown>>) => {
    const { payload, signature } = harness.gateway.sign({ type, object });

    return harness.app.inject({
      method: "POST",
      url: "/api/v1/payments/webhook",
      headers: { "content-type": "application/json", "stripe-signature": signature },
      payload,
    });
  },

  /** A PaymentIntent as Stripe sends it in an event about `charge`. */
  intent: (
    charge: Readonly<{ id: string; amountCents: number; intent: string }>,
    fields: Readonly<Record<string, unknown>> = {},
  ) => ({
    id: charge.intent,
    object: "payment_intent",
    amount: charge.amountCents,
    amount_received: charge.amountCents,
    currency: "eur",
    status: "succeeded",
    payment_method: "pm_card_visa",
    last_payment_error: null,
    metadata: { [PaymentGateway.PAYMENT_KEY]: charge.id },
    ...fields,
  }),

  /** Stripe telling the shop the charge succeeded. */
  succeed: (harness: Harness, charge: Readonly<{ id: string; amountCents: number; intent: string }>) =>
    Shop.webhook(harness, "payment_intent.succeeded", Shop.intent(charge)),

  /** Stripe telling the shop the card was declined with `code` and `declineCode`. */
  decline: (
    harness: Harness,
    charge: Readonly<{ id: string; amountCents: number; intent: string }>,
    code: string,
    declineCode?: string,
  ) =>
    Shop.webhook(
      harness,
      "payment_intent.payment_failed",
      Shop.intent(charge, {
        status: "requires_payment_method",
        amount_received: 0,
        last_payment_error: {
          type: "card_error",
          code,
          ...(declineCode === undefined ? {} : { decline_code: declineCode }),
          message: "Your card was declined.",
          payment_method: { id: "pm_declined", object: "payment_method", card: { brand: "visa", last4: "0002" } },
        },
      }),
    ),
} as const;
