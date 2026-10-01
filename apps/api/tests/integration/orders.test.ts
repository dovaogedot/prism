/**
 * Placing orders and paying for them, over a real Postgres. The payment
 * provider is the fake gateway; its webhooks are signed exactly as Stripe
 * signs them and go through the real route, the outbox, the queue and the
 * order service's consumer.
 */

import { PaymentFailure } from "@prism/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { App } from "../../src/app.ts";
import { Topology } from "../../src/messaging/topology.ts";
import { MessageQueue } from "../../src/platform/queue.ts";
import { CHECKOUT, Shop } from "../support/commerce.ts";
import { jsonOf, registerUser, seedCatalog, startHarness, type Harness } from "../support/harness.ts";

let harness: Harness;

beforeAll(async () => {
  harness = await startHarness();
});

afterAll(async () => {
  await harness.stop();
});

beforeEach(async () => {
  await harness.reset();
  await seedCatalog(harness, [
    { slug: "desk-lamp", name: "Desk Lamp", priceCents: 2500, stock: 5, images: ["lamp.png"] },
    { slug: "oak-chair", name: "Oak Chair", priceCents: 12_000, stock: 2, images: ["chair.png"] },
    { slug: "last-vase", name: "Last Vase", priceCents: 3000, stock: 1 },
  ]);
});

const orderOf = async (orderId: string, key?: string) =>
  jsonOf(await Shop.call(harness, "GET", `/orders/${orderId}${key === undefined ? "" : `?key=${key}`}`));

describe("POST /orders", () => {
  it("reserves the stock and stores a pending order with its lines and first event", async () => {
    const guest = await Shop.fill(harness, [
      ["desk-lamp", 2],
      ["oak-chair", 1],
    ]);
    const placed = await Shop.placed(harness, guest);

    expect(placed.clientSecret).toMatch(/^pi_fake_\d+_secret_fake$/);
    expect(placed.key).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(placed.number).toBe(100001);
    expect(await Shop.stockOf(harness, "desk-lamp")).toBe(3);
    expect(await Shop.stockOf(harness, "oak-chair")).toBe(1);

    const order = await orderOf(placed.orderId, placed.key);
    expect(order).toMatchObject({
      status: "pending_payment",
      subtotalCents: 17_000,
      shippingCents: 0,
      totalCents: 17_000,
      cancelable: true,
      events: [{ status: "pending_payment" }],
      payment: { status: "pending" },
    });
    expect(
      (order["lines"] as { name: string; quantity: number; image?: { url: string } }[]).map((line) => [
        line.name,
        line.quantity,
        line.image?.url,
      ]),
    ).toEqual([
      ["Desk Lamp", 2, "/media/lamp.png"],
      ["Oak Chair", 1, "/media/chair.png"],
    ]);
    expect(harness.gateway.calls.createIntent).toEqual([{ paymentId: placed.charge.id, amountCents: 17_000 }]);
  });

  it("charges what the server prices, with shipping under the free threshold", async () => {
    const guest = await Shop.fill(harness, [["desk-lamp", 1]]);
    const placed = await Shop.placed(harness, guest);

    expect(placed.charge.amountCents).toBe(2500 + 490);
  });

  it("refuses an empty cart, and a caller with no cart at all", async () => {
    const guest = await Shop.fill(harness, [["desk-lamp", 1]]);
    await Shop.call(harness, "DELETE", `/cart/items/${await Shop.productId(harness, "desk-lamp")}`, guest);

    for (const caller of [guest, {}]) {
      const response = await Shop.place(harness, caller, { expectedTotalCents: 0 });
      expect(response.statusCode).toBe(409);
      expect(jsonOf(response)["error"]).toMatchObject({ code: "CartEmpty" });
    }
  });

  it("refuses a total that is not what the cart costs, and reserves nothing", async () => {
    const guest = await Shop.fill(harness, [["desk-lamp", 1]]);
    const response = await Shop.place(harness, guest, { expectedTotalCents: 1 });

    expect(response.statusCode).toBe(409);
    expect(jsonOf(response)["error"]).toMatchObject({ code: "CartChanged" });
    expect(await Shop.stockOf(harness, "desk-lamp")).toBe(5);
  });

  it("refuses an address the lookup cannot find, on the street field", async () => {
    harness.addressVerifier.answer("not_found");
    const guest = await Shop.fill(harness, [["desk-lamp", 1]]);
    const response = await Shop.place(harness, guest);

    expect(response.statusCode).toBe(422);
    expect(jsonOf(response)["error"]).toMatchObject({
      code: "ValidationFailed",
      issues: [{ path: "address.line1", message: "We could not find this address. Check the street, postal code and city." }],
    });
  });

  it("lets the format check decide alone when the lookup is unavailable", async () => {
    harness.addressVerifier.answer("unavailable");
    const guest = await Shop.fill(harness, [["desk-lamp", 1]]);

    expect((await Shop.place(harness, guest)).statusCode).toBe(201);
  });

  it("refuses a malformed form with a message on every field", async () => {
    const guest = await Shop.fill(harness, [["desk-lamp", 1]]);
    const response = await Shop.place(harness, guest, {
      contact: { fullName: "", email: "nope", phone: "12" },
      address: { line1: "", city: "", postalCode: "ABC", country: "EE" },
    });
    const issues = (jsonOf(response)["error"] as { issues: { path: string }[] }).issues.map((issue) => issue.path);

    expect(response.statusCode).toBe(422);
    expect(issues).toEqual(
      expect.arrayContaining([
        "contact.fullName",
        "contact.email",
        "contact.phone",
        "address.line1",
        "address.city",
        "address.postalCode",
      ]),
    );
  });

  it("answers PaymentsUnavailable without a payment provider, and reserves nothing", async () => {
    const { app } = await App.build({
      config: harness.config,
      database: harness.database,
      overrides: { clock: harness.clock, mailer: harness.mailer, queue: MessageQueue.memory(Topology.declarations()) },
    });

    try {
      const guest = await Shop.fill(harness, [["desk-lamp", 1]]);
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/orders",
        cookies: { prism_cart: guest.guest ?? "" },
        payload: { ...CHECKOUT, shippingMethod: "standard", expectedTotalCents: 2990 },
      });

      expect(response.statusCode).toBe(503);
      expect(jsonOf(response)["error"]).toMatchObject({ code: "PaymentsUnavailable" });
      expect(await Shop.stockOf(harness, "desk-lamp")).toBe(5);
    } finally {
      await app.close();
    }
  });
});

describe("overselling", () => {
  it("lets exactly one of ten simultaneous checkouts have the last unit", async () => {
    const guests = await Promise.all(Array.from({ length: 10 }, () => Shop.fill(harness, [["last-vase", 1]])));
    const responses = await Promise.all(guests.map((guest) => Shop.place(harness, guest)));
    const statuses = responses.map((response) => response.statusCode).sort();

    expect(statuses).toEqual([201, ...Array.from({ length: 9 }, () => 409)]);
    for (const response of responses.filter((candidate) => candidate.statusCode === 409)) {
      expect(jsonOf(response)["error"]).toMatchObject({ code: "OutOfStock", issues: [{ message: "Sold out." }] });
    }
    expect(await Shop.stockOf(harness, "last-vase")).toBe(0);
    expect(harness.gateway.calls.createIntent).toHaveLength(1);
  });
});

describe("payment outcomes", () => {
  it("moves a paid order to payment successful through the queue, clears the cart and emails once", async () => {
    const guest = await Shop.fill(harness, [["desk-lamp", 2]]);
    const placed = await Shop.placed(harness, guest);

    expect((await Shop.succeed(harness, placed.charge)).statusCode).toBe(200);

    // Until the outbox is published and the queue delivered, the order has not heard.
    expect((await orderOf(placed.orderId, placed.key))["status"]).toBe("pending_payment");

    await harness.settle();

    const order = await orderOf(placed.orderId, placed.key);
    expect(order).toMatchObject({
      status: "payment_successful",
      payment: { status: "succeeded", card: { brand: "visa", last4: "4242" } },
    });
    expect(JSON.parse((await Shop.call(harness, "GET", "/cart", guest)).body)).toMatchObject({ itemCount: 0 });
    expect(harness.mailer.sent.map((email) => [email.to, email.subject])).toEqual([
      ["mari@example.com", "Order #100001 confirmed"],
    ]);
    expect(harness.mailer.sent[0]?.text).toContain(`/orders/${placed.orderId}?key=${placed.key}`);
    expect(await Shop.stockOf(harness, "desk-lamp")).toBe(3);
  });

  it("changes and emails once when the same webhook arrives twice", async () => {
    const guest = await Shop.fill(harness, [["desk-lamp", 1]]);
    const placed = await Shop.placed(harness, guest);

    await Shop.succeed(harness, placed.charge);
    await Shop.succeed(harness, placed.charge);
    await harness.settle();

    expect(harness.mailer.sent).toHaveLength(1);
    expect((await orderOf(placed.orderId, placed.key))["events"]).toHaveLength(2);
  });

  it.each([
    ["card_declined", "insufficient_funds", "insufficient_funds"],
    ["expired_card", undefined, "expired_card"],
    ["incorrect_cvc", undefined, "incorrect_cvc"],
    ["incorrect_number", undefined, "incorrect_number"],
    ["card_declined", "generic_decline", "card_declined"],
  ] as const)(
    "fails the order on %s/%s, restores the stock and emails the reason",
    async (code, declineCode, failure) => {
      const guest = await Shop.fill(harness, [["desk-lamp", 2]]);
      const placed = await Shop.placed(harness, guest);

      await Shop.decline(harness, placed.charge, code, declineCode);
      await harness.settle();

      const order = await orderOf(placed.orderId, placed.key);
      expect(order).toMatchObject({
        status: "payment_failed",
        cancelable: false,
        payment: { status: "failed", failure },
      });
      expect(order["events"]).toContainEqual(
        expect.objectContaining({ status: "payment_failed", note: PaymentFailure.message[failure] }),
      );
      expect(await Shop.stockOf(harness, "desk-lamp")).toBe(5);
      expect(harness.gateway.calls.cancelIntent).toEqual([placed.charge.intent]);
      expect(harness.mailer.sent).toHaveLength(1);
      expect(harness.mailer.sent[0]?.text).toContain(PaymentFailure.message[failure]);
      // The cart is still there to try again with another card.
      expect(JSON.parse((await Shop.call(harness, "GET", "/cart", guest)).body)).toMatchObject({ itemCount: 2 });
    },
  );

  it("answers a gateway timeout at once and fails the order through the queue", async () => {
    harness.gateway.failNext("createIntent", "gateway_timeout");
    const guest = await Shop.fill(harness, [["desk-lamp", 1]]);

    const response = await Shop.place(harness, guest);

    expect(response.statusCode).toBe(504);
    expect(jsonOf(response)["error"]).toMatchObject({
      code: "PaymentGatewayUnavailable",
      message: "The payment provider did not answer. You have not been charged.",
    });

    await harness.settle();

    const [row] = await harness.database.sql`SELECT id, status FROM customer_order`;
    expect(row?.["status"]).toBe("payment_failed");
    expect(await Shop.stockOf(harness, "desk-lamp")).toBe(5);
    expect(harness.mailer.sent[0]?.text).toContain(PaymentFailure.message.gateway_timeout);
  });

  it("ignores a success whose amount is not the charge's", async () => {
    const guest = await Shop.fill(harness, [["desk-lamp", 1]]);
    const placed = await Shop.placed(harness, guest);

    await Shop.webhook(harness, "payment_intent.succeeded", Shop.intent(placed.charge, { amount_received: 1 }));
    await harness.settle();

    expect((await orderOf(placed.orderId, placed.key))["status"]).toBe("pending_payment");
  });
});

describe("POST /payments/webhook", () => {
  it("refuses an unsigned or forged event", async () => {
    const guest = await Shop.fill(harness, [["desk-lamp", 1]]);
    const placed = await Shop.placed(harness, guest);
    const { payload } = harness.gateway.sign({ type: "payment_intent.succeeded", object: Shop.intent(placed.charge) });

    const unsigned = await harness.app.inject({
      method: "POST",
      url: "/api/v1/payments/webhook",
      headers: { "content-type": "application/json" },
      payload,
    });
    const forged = await harness.app.inject({
      method: "POST",
      url: "/api/v1/payments/webhook",
      headers: { "content-type": "application/json", "stripe-signature": "t=1,v1=00" },
      payload,
    });

    for (const response of [unsigned, forged]) {
      expect(response.statusCode).toBe(400);
      expect(jsonOf(response)["error"]).toMatchObject({ code: "WebhookSignatureInvalid" });
    }
    await harness.settle();
    expect((await orderOf(placed.orderId, placed.key))["status"]).toBe("pending_payment");
  });

  it("refuses a signed body that was altered on the way", async () => {
    const guest = await Shop.fill(harness, [["desk-lamp", 1]]);
    const placed = await Shop.placed(harness, guest);
    const { payload, signature } = harness.gateway.sign({
      type: "payment_intent.payment_failed",
      object: Shop.intent(placed.charge),
    });

    const response = await harness.app.inject({
      method: "POST",
      url: "/api/v1/payments/webhook",
      headers: { "content-type": "application/json", "stripe-signature": signature },
      payload: payload.replace("payment_failed", "succeeded"),
    });

    expect(response.statusCode).toBe(400);
  });

  it("acknowledges and ignores an event without Prism's metadata", async () => {
    const response = await Shop.webhook(harness, "payment_intent.succeeded", {
      id: "pi_from_stripe_trigger",
      object: "payment_intent",
      amount: 2000,
      amount_received: 2000,
      metadata: {},
    });

    expect(response.statusCode).toBe(200);
    expect(await harness.database.sql`SELECT id FROM outbox_message`).toHaveLength(0);
  });

  it("acknowledges an event type it does not act on", async () => {
    expect((await Shop.webhook(harness, "customer.created", { id: "cus_1", object: "customer" })).statusCode).toBe(200);
  });
});

describe("encryption at rest", () => {
  it("stores the contact, address, key and payment record as ciphertext, and serves them as plaintext", async () => {
    const guest = await Shop.fill(harness, [["desk-lamp", 1]]);
    const placed = await Shop.placed(harness, guest);
    await Shop.succeed(harness, placed.charge);
    await harness.settle();

    const [order] = await harness.database.sql`SELECT contact, shipping_address, access_key FROM customer_order`;
    const [payment] = await harness.database.sql`SELECT reference, details FROM payment`;
    const stored = [order?.["contact"], order?.["shipping_address"], order?.["access_key"], payment?.["reference"], payment?.["details"]]
      .map((value) => Buffer.from(value as Uint8Array).toString("latin1"))
      .join("\n");

    for (const plaintext of ["Mari", "mari@example.com", "51234567", "Narva", "Tallinn", "10117", placed.key ?? "", placed.charge.intent, "4242", "visa"]) {
      expect(stored, plaintext).not.toContain(plaintext);
    }

    expect(await orderOf(placed.orderId, placed.key)).toMatchObject({
      contact: { fullName: "Mari Maasikas", email: "mari@example.com", phone: "+37251234567" },
      address: { line1: "Narva mnt 7", city: "Tallinn", postalCode: "10117", country: "EE" },
    });
  });
});

describe("signed-in checkout", () => {
  it("places an order without a key, reachable by its owner only", async () => {
    const owner = await registerUser(harness, "owner@example.com");
    const other = await registerUser(harness, "other@example.com");
    const caller = await Shop.fill(harness, [["desk-lamp", 1]], { token: owner.accessToken });
    const placed = await Shop.placed(harness, caller);

    expect(placed.key).toBeUndefined();
    expect((await Shop.call(harness, "GET", `/orders/${placed.orderId}`, { token: owner.accessToken })).statusCode).toBe(200);
    expect((await Shop.call(harness, "GET", `/orders/${placed.orderId}`, { token: other.accessToken })).statusCode).toBe(404);
    expect((await Shop.call(harness, "GET", `/orders/${placed.orderId}`)).statusCode).toBe(404);
  });
});
