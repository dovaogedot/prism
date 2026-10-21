/**
 * The shop's side of an order: delivery options that staff edit, the steps
 * a delivery manager moves a paid order through, and the cancellations and
 * refunds support makes. Payments run through the fake gateway and the
 * memory queue, except where the simulated provider is under test.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { App } from "../../src/app.ts";
import { Config, Environment } from "../../src/config.ts";
import { Topology } from "../../src/messaging/topology.ts";
import { OutboxRelay } from "../../src/messaging/outbox.ts";
import { MessageQueue } from "../../src/platform/queue.ts";
import { CHECKOUT, Shop, type Caller } from "../support/commerce.ts";
import { jsonOf, registerUser, seedCatalog, startHarness, testEnvironment, type Harness } from "../support/harness.ts";
import { Staff, type TestAccount } from "../support/staff.ts";

let harness: Harness;
let delivery: TestAccount;
let support: TestAccount;

beforeAll(async () => {
  harness = await startHarness();
}, 180_000);

afterAll(async () => {
  await harness.stop();
});

beforeEach(async () => {
  await harness.reset();
  await seedCatalog(harness, [
    { slug: "desk-lamp", name: "Desk Lamp", priceCents: 2500, stock: 50 },
    { slug: "sticker", name: "Sticker", priceCents: 20, stock: 50 },
  ]);
  delivery = await Staff.account(harness, "delivery@example.com", ["delivery_manager"]);
  support = await Staff.account(harness, "support@example.com", ["support"]);
});

type Detail = {
  status: string;
  shippingMethodName: string;
  shippingCents: number;
  estimatedDelivery: { from: string; to: string };
  events: { status: string; note?: string }[];
  payment?: { status: string; reference?: string; refund?: string };
  trackingNumber?: string;
  nextStatus?: string;
  canCancel: boolean;
  canRefund: boolean;
};

const adminDetail = async (orderId: string): Promise<Detail> =>
  jsonOf(await Staff.call(harness, support, "GET", `/admin/orders/${orderId}`)) as unknown as Detail;

/** Places an order as `caller` with `method` and has Stripe pay for it. */
const paidOrder = async (caller: Caller = {}, method = "standard") => {
  const filled = await Shop.fill(harness, [["desk-lamp", 1]], caller);
  const response = await Shop.place(harness, filled, {
    shippingMethod: method,
    expectedTotalCents: await Shop.totalOf(harness, filled, method),
  });
  if (response.statusCode !== 201) throw new Error(`placing failed: ${response.body}`);

  const placed = JSON.parse(response.body) as { orderId: string; key?: string };
  const charge = await Shop.chargeOf(harness, placed.orderId);
  await Shop.succeed(harness, charge);
  await harness.settle();
  return { ...placed, charge };
};

const step = (orderId: string, body: object) => Staff.call(harness, delivery, "POST", `/admin/orders/${orderId}/status`, body);

/** A delivery option as the admin form sends it. */
const methodInput = (overrides: Readonly<Record<string, unknown>> = {}) => ({
  code: "pigeon",
  name: "Pigeon post",
  priceCents: 300,
  minDays: 3,
  maxDays: 5,
  isActive: true,
  position: 5,
  ...overrides,
});

describe("delivery options", () => {
  it("lists the active options in order for checkout", async () => {
    await Staff.call(harness, delivery, "POST", "/admin/shipping-methods", methodInput({ position: 0, code: "pickup", name: "Pickup", priceCents: 0 }));
    await Staff.call(harness, delivery, "POST", "/admin/shipping-methods", methodInput({ isActive: false }));

    const { items } = jsonOf(await Shop.call(harness, "GET", "/shipping-methods")) as { items: { code: string }[] };

    expect(items.map((item) => item.code)).toEqual(["pickup", "standard", "express"]);
  });

  it("charges an edited price on the next order, and older orders keep theirs", async () => {
    const before = await paidOrder({}, "express");

    const edited = await Staff.call(
      harness,
      delivery,
      "PUT",
      "/admin/shipping-methods/express",
      methodInput({ code: "express", name: "Express courier", priceCents: 1490, minDays: 1, maxDays: 1, position: 1 }),
    );
    expect(edited.statusCode).toBe(200);

    const after = await paidOrder({}, "express");

    expect(await adminDetail(before.orderId)).toMatchObject({ shippingCents: 990, shippingMethodName: "Express" });
    expect(await adminDetail(after.orderId)).toMatchObject({ shippingCents: 1490, shippingMethodName: "Express courier" });
  });

  it("keeps an option that orders use: it can be deactivated, not deleted", async () => {
    await paidOrder({}, "express");

    const deleted = await Staff.call(harness, delivery, "DELETE", "/admin/shipping-methods/express");
    expect(jsonOf(deleted)["error"]).toMatchObject({ code: "ShippingMethodInUse" });

    const deactivated = await Staff.call(
      harness,
      delivery,
      "PUT",
      "/admin/shipping-methods/express",
      methodInput({ code: "express", name: "Express", priceCents: 990, minDays: 1, maxDays: 2, isActive: false, position: 1 }),
    );
    expect(jsonOf(deactivated)).toMatchObject({ isActive: false, orderCount: 1 });
  });

  it("deletes an option nobody used", async () => {
    await Staff.call(harness, delivery, "POST", "/admin/shipping-methods", methodInput());

    expect((await Staff.call(harness, delivery, "DELETE", "/admin/shipping-methods/pigeon")).statusCode).toBe(204);
    expect(await harness.database.sql`SELECT action FROM audit_event WHERE target_type = 'shipping_method' ORDER BY id`).toEqual([
      { action: "shipping_method.create" },
      { action: "shipping_method.delete" },
    ]);
  });

  it("refuses an inactive option at placement, with an issue on the method", async () => {
    await Staff.call(
      harness,
      delivery,
      "PUT",
      "/admin/shipping-methods/express",
      methodInput({ code: "express", name: "Express", priceCents: 990, minDays: 1, maxDays: 2, isActive: false, position: 1 }),
    );
    const filled = await Shop.fill(harness, [["desk-lamp", 1]]);

    const response = await Shop.place(harness, filled, { shippingMethod: "express", expectedTotalCents: 3490 });

    expect(response.statusCode).toBe(422);
    expect(jsonOf(response)["error"]).toMatchObject({ issues: [{ path: "shippingMethod" }] });
  });

  it("refuses a code no option has, with an issue on the method", async () => {
    const filled = await Shop.fill(harness, [["desk-lamp", 1]]);

    const response = await Shop.place(harness, filled, { shippingMethod: "drone", expectedTotalCents: 3490 });

    expect(response.statusCode).toBe(422);
    expect(jsonOf(response)["error"]).toMatchObject({ issues: [{ path: "shippingMethod" }] });
  });

  it("refuses a window whose earliest day comes after its latest", async () => {
    const response = await Staff.call(harness, delivery, "POST", "/admin/shipping-methods", methodInput({ minDays: 6, maxDays: 2 }));

    expect(response.statusCode).toBe(422);
    expect(jsonOf(response)["error"]).toMatchObject({ issues: [{ path: "maxDays" }] });
  });
});

describe("fulfillment", () => {
  it("moves a paid order through processing, shipped and delivered, emailing each arrival once", async () => {
    const placed = await paidOrder();
    harness.mailer.clear();

    expect((await step(placed.orderId, { status: "processing" })).statusCode).toBe(200);
    expect((await step(placed.orderId, { status: "shipped", trackingNumber: "PR123456789EE" })).statusCode).toBe(200);
    expect((await step(placed.orderId, { status: "delivered" })).statusCode).toBe(200);

    const detail = await adminDetail(placed.orderId);
    expect(detail).toMatchObject({ status: "delivered", trackingNumber: "PR123456789EE", canRefund: true, canCancel: false });
    expect(detail.nextStatus).toBeUndefined();
    expect(harness.mailer.sent.map((email) => email.subject)).toEqual(["Order #100001 shipped", "Order #100001 delivered"]);
    expect(harness.mailer.sent[1]?.text).toContain("/products/desk-lamp#review");
  });

  it("refuses a skipped step and a step backwards", async () => {
    const placed = await paidOrder();

    const skipped = await step(placed.orderId, { status: "delivered" });
    expect(jsonOf(skipped)["error"]).toMatchObject({ code: "OrderTransitionNotAllowed" });

    await step(placed.orderId, { status: "processing" });
    await step(placed.orderId, { status: "shipped", trackingNumber: "PR123456789EE" });
    const backwards = await step(placed.orderId, { status: "processing" });
    expect(jsonOf(backwards)["error"]).toMatchObject({ code: "OrderTransitionNotAllowed" });

    const repeated = await step(placed.orderId, { status: "shipped", trackingNumber: "PR999999999EE" });
    expect(jsonOf(repeated)["error"]).toMatchObject({ code: "OrderTransitionNotAllowed" });
    expect((await adminDetail(placed.orderId)).trackingNumber).toBe("PR123456789EE");
  });

  it("needs a tracking number to ship", async () => {
    const placed = await paidOrder();
    await step(placed.orderId, { status: "processing" });

    const response = await step(placed.orderId, { status: "shipped" });

    expect(response.statusCode).toBe(422);
    expect((await adminDetail(placed.orderId)).status).toBe("processing");
  });

  it("is open to delivery managers and admins only", async () => {
    const placed = await paidOrder();

    const response = await Staff.call(harness, support, "POST", `/admin/orders/${placed.orderId}/status`, { status: "processing" });

    expect(response.statusCode).toBe(403);
  });
});

describe("cancellations and refunds by support", () => {
  it("cancels a processing order: the stock comes back and the payment is refunded", async () => {
    const placed = await paidOrder();
    await step(placed.orderId, { status: "processing" });
    expect(await Shop.stockOf(harness, "desk-lamp")).toBe(49);

    const response = await Staff.call(harness, support, "POST", `/admin/orders/${placed.orderId}/cancel`);
    await harness.settle();

    expect(response.statusCode).toBe(200);
    expect(await Shop.stockOf(harness, "desk-lamp")).toBe(50);
    expect(await adminDetail(placed.orderId)).toMatchObject({
      status: "canceled",
      payment: { status: "succeeded", refund: "succeeded" },
    });
  });

  it("refunds a delivered order in full and leaves the stock alone", async () => {
    const placed = await paidOrder();
    await step(placed.orderId, { status: "processing" });
    await step(placed.orderId, { status: "shipped", trackingNumber: "PR123456789EE" });
    await step(placed.orderId, { status: "delivered" });
    harness.mailer.clear();

    const response = await Staff.call(harness, support, "POST", `/admin/orders/${placed.orderId}/refund`);
    await harness.settle();

    expect(response.statusCode).toBe(200);
    const detail = await adminDetail(placed.orderId);
    expect(detail).toMatchObject({ status: "refunded", canRefund: false, payment: { refund: "succeeded" } });
    expect(detail.events.map((event) => event.note)).toContain("Refund issued");
    expect(harness.gateway.calls.refund).toEqual([{ refundId: expect.any(String), intent: placed.charge.intent, amountCents: 2990 }]);
    expect(harness.mailer.sent.map((email) => email.subject)).toEqual(["Refund for order #100001"]);
    expect(await Shop.stockOf(harness, "desk-lamp")).toBe(49);

    const again = await Staff.call(harness, support, "POST", `/admin/orders/${placed.orderId}/refund`);
    await harness.settle();
    expect(jsonOf(again)["error"]).toMatchObject({ code: "OrderTransitionNotAllowed" });
    expect(harness.gateway.calls.refund).toHaveLength(1);
  });

  it("refuses to refund an order that has not shipped, where canceling applies", async () => {
    const placed = await paidOrder();

    const response = await Staff.call(harness, support, "POST", `/admin/orders/${placed.orderId}/refund`);

    expect(jsonOf(response)["error"]).toMatchObject({ code: "OrderTransitionNotAllowed" });
  });

  it("records each change in the audit log", async () => {
    const placed = await paidOrder();
    await step(placed.orderId, { status: "processing" });
    await Staff.call(harness, support, "POST", `/admin/orders/${placed.orderId}/cancel`);

    expect(
      await harness.database.sql`SELECT action, actor_id FROM audit_event WHERE target_type = 'order' ORDER BY id`,
    ).toEqual([
      { action: "order.status", actor_id: delivery.userId },
      { action: "order.cancel", actor_id: support.userId },
    ]);
  });

  it("finds orders by the customer's email and by number", async () => {
    const { accessToken } = await registerUser(harness, "buyer@example.com");
    const placed = await paidOrder({ token: accessToken });
    await paidOrder();

    const byEmail = jsonOf(await Staff.call(harness, support, "GET", "/admin/orders?email=Mari@Example.com"));
    const byNumber = jsonOf(await Staff.call(harness, support, "GET", "/admin/orders?number=100001"));

    expect(byEmail["total"]).toBe(2);
    expect(byNumber["items"]).toEqual([
      expect.objectContaining({ id: placed.orderId, customerEmail: "mari@example.com", isGuest: false }),
    ]);
  });
});

describe("placement", () => {
  it("refuses a total under €0.50", async () => {
    await Staff.call(
      harness,
      delivery,
      "POST",
      "/admin/shipping-methods",
      methodInput({ code: "pickup", name: "Pickup", priceCents: 0, position: 0 }),
    );
    const filled = await Shop.fill(harness, [["sticker", 1]]);

    const response = await Shop.place(harness, filled, { shippingMethod: "pickup", expectedTotalCents: 20 });

    expect(response.statusCode).toBe(422);
    expect(jsonOf(response)["error"]).toMatchObject({ code: "OrderTotalTooSmall" });
  });

  it("records the method's name and the delivery dates on the order", async () => {
    const placed = await paidOrder();

    expect(await adminDetail(placed.orderId)).toMatchObject({
      shippingMethodName: "Standard",
      estimatedDelivery: { from: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), to: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) },
    });
  });
});

describe("the simulated payment provider", () => {
  it("takes an order to payment_successful through the outbox and the queue", async () => {
    const queue = MessageQueue.memory(Topology.declarations());
    const simulated = await App.build({
      config: Config.fromEnvironment(
        Environment.schema.parse({
          ...testEnvironment(harness.config.database.url, harness.mediaDirectory),
          PORT: "8080",
          SMTP_SECURE: "false",
          PAYMENTS_MODE: "simulated",
        }),
      ),
      database: harness.database,
      overrides: { clock: harness.clock, mailer: harness.mailer, queue },
    });
    const relay = OutboxRelay.create({ db: harness.database.db, queue, onFailure: () => undefined });

    try {
      const config = await simulated.app.inject({ method: "GET", url: "/api/v1/checkout/config" });
      expect(jsonOf(config)).toEqual({ provider: "simulated" });

      const cart = await simulated.app.inject({
        method: "POST",
        url: "/api/v1/cart/items",
        payload: { productId: await Shop.productId(harness, "desk-lamp"), quantity: 1 },
      });
      const guest = cart.cookies.find((cookie) => cookie.name === "prism_cart")?.value ?? "";
      const placed = await simulated.app.inject({
        method: "POST",
        url: "/api/v1/orders",
        cookies: { prism_cart: guest },
        payload: { ...CHECKOUT, shippingMethod: "standard", expectedTotalCents: 2990 },
      });
      expect(placed.statusCode).toBe(201);

      await relay.flush();
      await queue.drain();

      const { orderId, key } = jsonOf(placed) as { orderId: string; key: string };
      const order = await simulated.app.inject({ method: "GET", url: `/api/v1/orders/${orderId}?key=${key}` });
      expect(jsonOf(order)).toMatchObject({
        status: "payment_successful",
        payment: { status: "succeeded", reference: expect.stringMatching(/^pi_simulated_/) },
      });
    } finally {
      await simulated.app.close();
    }
  });

  it("refuses to start anywhere but localhost", () => {
    const parsed = Environment.schema.safeParse({
      ...testEnvironment(harness.config.database.url, harness.mediaDirectory),
      PORT: "8080",
      SMTP_SECURE: "false",
      PAYMENTS_MODE: "simulated",
      PUBLIC_WEB_URL: "https://shop.example.com",
    });

    expect(parsed.success).toBe(false);
  });
});
