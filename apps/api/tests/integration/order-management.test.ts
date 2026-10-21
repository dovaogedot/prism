/**
 * After the sale: listing and filtering orders, who may read one, canceling
 * with a refund through the queue, expiry of unpaid orders, and the checkout
 * prefill. Time moves through the harness clock; nothing waits. The staff's
 * side of an order is in `fulfillment.test.ts`.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Shop, type Caller } from "../support/commerce.ts";
import { jsonOf, registerUser, seedCatalog, startHarness, VALID_PASSWORD, type Harness } from "../support/harness.ts";
import { Staff } from "../support/staff.ts";

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
    { slug: "desk-lamp", name: "Desk Lamp", priceCents: 2500, stock: 50 },
    { slug: "oak-chair", name: "Oak Chair", priceCents: 12_000, stock: 50 },
  ]);
});

type Detail = {
  status: string;
  cancelable: boolean;
  events: { status: string; note?: string }[];
  payment?: { status: string; refund?: string };
  trackingNumber?: string;
};

const detailOf = async (orderId: string, caller: Caller, key?: string): Promise<Detail> =>
  jsonOf(await Shop.call(harness, "GET", `/orders/${orderId}${key === undefined ? "" : `?key=${key}`}`, caller)) as unknown as Detail;

/** Places an order as `caller` and has Stripe pay for it. */
const paidOrder = async (caller: Caller, slug = "desk-lamp") => {
  const filled = await Shop.fill(harness, [[slug, 1]], caller);
  const placed = await Shop.placed(harness, filled);
  await Shop.succeed(harness, placed.charge);
  await harness.settle();
  return placed;
};

describe("GET /orders", () => {
  type List = { items: { number: number; status: string; createdAt: string; itemCount: number }[]; total: number };

  /** A fresh access token: the one from registering expires long before a simulated day ends. */
  const signIn = async (email: string): Promise<string> => {
    const response = await harness.app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email, password: VALID_PASSWORD },
    });
    return (jsonOf(response)["grant"] as { accessToken: string }).accessToken;
  };

  /** Three orders a day apart, paid, failed and pending. Resolves to a token valid at the end. */
  const threeOrders = async (email: string): Promise<string> => {
    await paidOrder({ token: await signIn(email) });

    harness.clock.advanceSeconds(24 * 60 * 60);
    const failed = await Shop.placed(harness, await Shop.fill(harness, [["oak-chair", 2]], { token: await signIn(email) }));
    await Shop.decline(harness, failed.charge, "card_declined", "insufficient_funds");
    await harness.settle();

    harness.clock.advanceSeconds(24 * 60 * 60);
    const token = await signIn(email);
    await Shop.placed(harness, await Shop.fill(harness, [["desk-lamp", 1]], { token }));

    return token;
  };

  const list = async (token: string, query = "") =>
    jsonOf(await Shop.call(harness, "GET", `/orders${query}`, { token })) as unknown as List;

  it("lists only the caller's orders, newest first", async () => {
    await registerUser(harness, "buyer@example.com");
    await registerUser(harness, "other@example.com");
    const accessToken = await threeOrders("buyer@example.com");
    await paidOrder({ token: await signIn("other@example.com") });

    const body = await list(accessToken);

    expect(body.total).toBe(3);
    // The declined chairs stayed in the cart, so the third order carries them too.
    expect(body.items.map((item) => [item.number, item.status, item.itemCount])).toEqual([
      [100003, "pending_payment", 3],
      [100002, "payment_failed", 2],
      [100001, "payment_successful", 1],
    ]);
  });

  it("filters by one status or several", async () => {
    await registerUser(harness, "buyer@example.com");
    const accessToken = await threeOrders("buyer@example.com");

    expect((await list(accessToken, "?status=payment_failed")).items.map((item) => item.number)).toEqual([100002]);
    expect(
      (await list(accessToken, "?status=payment_failed&status=pending_payment")).items.map((item) => item.number),
    ).toEqual([100003, 100002]);
  });

  it("filters by a date range whose ends both count", async () => {
    await registerUser(harness, "buyer@example.com");
    const accessToken = await threeOrders("buyer@example.com");
    const days = (await list(accessToken)).items.map((item) => item.createdAt.slice(0, 10));

    expect((await list(accessToken, `?from=${days[1]}&to=${days[1]}`)).items.map((item) => item.number)).toEqual([100002]);
    expect((await list(accessToken, `?from=${days[1]}`)).items.map((item) => item.number)).toEqual([100003, 100002]);
    expect((await list(accessToken, `?to=${days[1]}`)).items.map((item) => item.number)).toEqual([100002, 100001]);
  });

  it("sorts oldest first, and by status in lifecycle order", async () => {
    await registerUser(harness, "buyer@example.com");
    const accessToken = await threeOrders("buyer@example.com");

    expect((await list(accessToken, "?sort=oldest")).items.map((item) => item.number)).toEqual([100001, 100002, 100003]);
    expect((await list(accessToken, "?sort=status")).items.map((item) => item.status)).toEqual([
      "pending_payment",
      "payment_successful",
      "payment_failed",
    ]);
  });

  it("pages", async () => {
    await registerUser(harness, "buyer@example.com");
    const accessToken = await threeOrders("buyer@example.com");

    const second = (await list(accessToken, "?perPage=2&page=2")) as List & { totalPages: number };
    expect(second.items.map((item) => item.number)).toEqual([100001]);
    expect(second.totalPages).toBe(2);
  });

  it("refuses a guest, and a malformed filter", async () => {
    const { accessToken } = await registerUser(harness, "buyer@example.com");

    expect((await Shop.call(harness, "GET", "/orders")).statusCode).toBe(401);
    expect((await Shop.call(harness, "GET", "/orders?status=lost", { token: accessToken })).statusCode).toBe(422);
    expect((await Shop.call(harness, "GET", "/orders?from=2026-09-02&to=2026-09-01", { token: accessToken })).statusCode).toBe(422);
  });
});

describe("GET /orders/:id", () => {
  it("opens a guest order with its key, and answers 404 to a wrong or missing key", async () => {
    const placed = await Shop.placed(harness, await Shop.fill(harness, [["desk-lamp", 1]]));
    const wrongKey = "A".repeat(43);

    expect((await Shop.call(harness, "GET", `/orders/${placed.orderId}?key=${placed.key}`)).statusCode).toBe(200);
    expect((await Shop.call(harness, "GET", `/orders/${placed.orderId}?key=${wrongKey}`)).statusCode).toBe(404);
    expect((await Shop.call(harness, "GET", `/orders/${placed.orderId}`)).statusCode).toBe(404);
    expect((await Shop.call(harness, "GET", `/orders/00000000-0000-4000-8000-000000000000?key=${placed.key}`)).statusCode).toBe(404);
  });
});

describe("POST /orders/:id/cancel", () => {
  it("cancels an unpaid order, gives the stock back and cancels the intent", async () => {
    const placed = await Shop.placed(harness, await Shop.fill(harness, [["desk-lamp", 3]]));
    expect(await Shop.stockOf(harness, "desk-lamp")).toBe(47);

    const response = await Shop.call(harness, "POST", `/orders/${placed.orderId}/cancel?key=${placed.key}`);
    await harness.settle();

    expect(response.statusCode).toBe(200);
    expect(jsonOf(response)).toMatchObject({ status: "canceled", cancelable: false });
    expect(await Shop.stockOf(harness, "desk-lamp")).toBe(50);
    expect(harness.gateway.calls.cancelIntent).toEqual([placed.charge.intent]);
    expect(harness.gateway.calls.refund).toEqual([]);
    expect((await detailOf(placed.orderId, {}, placed.key)).payment).toMatchObject({ status: "canceled" });
    expect(harness.mailer.sent.map((email) => email.subject)).toEqual(["Order #100001 canceled"]);
  });

  it("cancels a paid order and refunds it through the queue", async () => {
    const { accessToken } = await registerUser(harness, "buyer@example.com");
    const placed = await paidOrder({ token: accessToken });
    harness.mailer.clear();

    const response = await Shop.call(harness, "POST", `/orders/${placed.orderId}/cancel`, { token: accessToken });
    expect(response.statusCode).toBe(200);

    await harness.settle();

    expect(harness.gateway.calls.refund).toEqual([
      { refundId: expect.any(String), intent: placed.charge.intent, amountCents: placed.charge.amountCents },
    ]);
    const detail = await detailOf(placed.orderId, { token: accessToken });
    expect(detail).toMatchObject({ status: "canceled", payment: { status: "succeeded", refund: "succeeded" } });
    expect(detail.events.map((event) => event.note ?? event.status)).toEqual([
      "pending_payment",
      "payment_successful",
      "Canceled by the customer",
      "Refund issued",
    ]);
    expect(harness.mailer.sent.map((email) => email.subject)).toEqual([
      "Order #100001 canceled",
      "Refund for order #100001",
    ]);
    expect(await Shop.stockOf(harness, "desk-lamp")).toBe(50);
  });

  it("retries a refund the provider refused, then succeeds", async () => {
    const { accessToken } = await registerUser(harness, "buyer@example.com");
    const placed = await paidOrder({ token: accessToken });
    harness.gateway.failNext("refund", "gateway_timeout");

    await Shop.call(harness, "POST", `/orders/${placed.orderId}/cancel`, { token: accessToken });
    await harness.settle();

    expect(harness.gateway.calls.refund).toHaveLength(2);
    expect(harness.queue.deadLetters).toEqual([]);
    expect((await detailOf(placed.orderId, { token: accessToken })).payment).toMatchObject({ refund: "succeeded" });
  });

  it("dead-letters a refund that keeps failing, after the delivery limit", async () => {
    const { accessToken } = await registerUser(harness, "buyer@example.com");
    const placed = await paidOrder({ token: accessToken });
    const failingRefund = harness.gateway.refund;
    Object.assign(harness.gateway, {
      refund: (input: Parameters<typeof failingRefund>[0]) => {
        harness.gateway.failNext("refund", "gateway_error");
        return failingRefund(input);
      },
    });

    try {
      await Shop.call(harness, "POST", `/orders/${placed.orderId}/cancel`, { token: accessToken });
      await harness.settle();
    } finally {
      Object.assign(harness.gateway, { refund: failingRefund });
    }

    expect(harness.queue.deadLetters).toEqual([
      { queue: "payments.order-canceled", body: { orderId: placed.orderId }, reason: "delivery_limit" },
    ]);
  });

  it("refuses an order that is already processing", async () => {
    const { accessToken } = await registerUser(harness, "buyer@example.com");
    const placed = await paidOrder({ token: accessToken });
    const delivery = await Staff.account(harness, "delivery@example.com", ["delivery_manager"]);
    await Staff.call(harness, delivery, "POST", `/admin/orders/${placed.orderId}/status`, { status: "processing" });

    const response = await Shop.call(harness, "POST", `/orders/${placed.orderId}/cancel`, { token: accessToken });

    expect(response.statusCode).toBe(409);
    expect(jsonOf(response)["error"]).toMatchObject({ code: "OrderNotCancelable" });
  });

  it("answers 404 to someone else's order, and changes nothing", async () => {
    const owner = await registerUser(harness, "owner@example.com");
    const other = await registerUser(harness, "other@example.com");
    const placed = await Shop.placed(harness, await Shop.fill(harness, [["desk-lamp", 1]], { token: owner.accessToken }));

    const response = await Shop.call(harness, "POST", `/orders/${placed.orderId}/cancel`, { token: other.accessToken });

    expect(response.statusCode).toBe(404);
    expect((await detailOf(placed.orderId, { token: owner.accessToken })).status).toBe("pending_payment");
  });
});

describe("housekeeping", () => {
  it("expires an unpaid order after its window and gives the stock back", async () => {
    const placed = await Shop.placed(harness, await Shop.fill(harness, [["desk-lamp", 2]]));

    harness.clock.advanceSeconds(harness.config.commerce.paymentWindowSeconds - 1);
    expect((await harness.jobs.housekeeping.run()).expired).toBe(0);

    harness.clock.advanceSeconds(1);
    expect((await harness.jobs.housekeeping.run()).expired).toBe(1);
    await harness.settle();

    const detail = await detailOf(placed.orderId, {}, placed.key);
    expect(detail.status).toBe("canceled");
    expect(detail.events.at(-1)).toMatchObject({ status: "canceled", note: "Payment window expired" });
    expect(await Shop.stockOf(harness, "desk-lamp")).toBe(50);
    expect(harness.gateway.calls.cancelIntent).toEqual([placed.charge.intent]);
  });

  it("refunds a payment that arrives after the order expired", async () => {
    const placed = await Shop.placed(harness, await Shop.fill(harness, [["desk-lamp", 1]]));
    harness.clock.advanceSeconds(harness.config.commerce.paymentWindowSeconds);
    await harness.jobs.housekeeping.run();
    await harness.settle();

    await Shop.succeed(harness, placed.charge);
    await harness.settle();

    expect(harness.gateway.calls.refund).toHaveLength(1);
    expect(await detailOf(placed.orderId, {}, placed.key)).toMatchObject({
      status: "canceled",
      payment: { status: "succeeded", refund: "succeeded" },
    });
  });
});

describe("GET /checkout/prefill", () => {
  it("offers the account email, then the details of the last order", async () => {
    const { accessToken } = await registerUser(harness, "buyer@example.com");

    expect(jsonOf(await Shop.call(harness, "GET", "/checkout/prefill", { token: accessToken }))).toEqual({
      email: "buyer@example.com",
    });

    await Shop.placed(harness, await Shop.fill(harness, [["desk-lamp", 1]], { token: accessToken }));

    expect(jsonOf(await Shop.call(harness, "GET", "/checkout/prefill", { token: accessToken }))).toEqual({
      email: "buyer@example.com",
      contact: { fullName: "Mari Maasikas", email: "mari@example.com", phone: "+37251234567" },
      address: { line1: "Narva mnt 7", city: "Tallinn", postalCode: "10117", country: "EE" },
      shippingMethod: "standard",
    });
  });

  it("refuses a guest", async () => {
    expect((await Shop.call(harness, "GET", "/checkout/prefill")).statusCode).toBe(401);
  });
});

describe("POST /checkout/address", () => {
  it("answers what the lookup found", async () => {
    const address = { line1: "Narva mnt 7", city: "Tallinn", postalCode: "10117", country: "EE" };

    expect(jsonOf(await Shop.call(harness, "POST", "/checkout/address", {}, address))).toEqual({ status: "verified" });

    harness.addressVerifier.answer("not_found");
    expect(jsonOf(await Shop.call(harness, "POST", "/checkout/address", {}, address))).toEqual({ status: "not_found" });
  });

  it("checks the format before asking anyone", async () => {
    const response = await Shop.call(harness, "POST", "/checkout/address", {}, {
      line1: "Narva mnt 7",
      city: "Tallinn",
      postalCode: "1",
      country: "EE",
    });

    expect(response.statusCode).toBe(422);
    expect(harness.addressVerifier.asked).toHaveLength(0);
  });
});
