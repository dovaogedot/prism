/**
 * A guest's whole purchase: browse, fill the cart, change it, check the
 * address, place the order, pay, read the order through the link in the
 * email, and cancel it for a refund. Stripe is the fake gateway, whose
 * webhooks are signed the way Stripe signs them.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CHECKOUT, Shop } from "../support/commerce.ts";
import { jsonOf, seedCatalog, startHarness, type Harness } from "../support/harness.ts";

let harness: Harness;

beforeAll(async () => {
  harness = await startHarness();
  await harness.reset();
  await seedCatalog(harness, [
    { slug: "desk-lamp", name: "Desk Lamp", priceCents: 2500, stock: 5, category: "Lighting", images: ["lamp.png"] },
    { slug: "floor-lamp", name: "Floor Lamp", priceCents: 1900, stock: 4, category: "Lighting" },
  ]);
});

afterAll(async () => {
  await harness.stop();
});

describe("a guest checkout", () => {
  it("goes from browsing to a paid order, and back to a refund", async () => {
    // Browsing finds both lamps.
    const listing = jsonOf(await Shop.call(harness, "GET", "/products?category=lighting")) as { items: { slug: string }[] };
    expect(listing.items.map((item) => item.slug).sort()).toEqual(["desk-lamp", "floor-lamp"]);

    // Two products in, one quantity changed, with live totals.
    const guest = await Shop.fill(harness, [
      ["desk-lamp", 1],
      ["floor-lamp", 2],
    ]);
    const desk = await Shop.productId(harness, "desk-lamp");
    const changed = jsonOf(await Shop.call(harness, "PUT", `/cart/items/${desk}`, guest, { quantity: 2 }));
    expect(changed).toMatchObject({ itemCount: 4, subtotalCents: 2 * 2500 + 2 * 1900 });

    // The address is checked before the order is placed.
    expect(jsonOf(await Shop.call(harness, "POST", "/checkout/address", guest, CHECKOUT.address))).toEqual({
      status: "verified",
    });

    // €88.00 is over the free-shipping threshold.
    const placedResponse = await Shop.call(harness, "POST", "/orders", guest, {
      ...CHECKOUT,
      shippingMethod: "standard",
      expectedTotalCents: 8800,
    });
    expect(placedResponse.statusCode).toBe(201);
    const placed = jsonOf(placedResponse) as { orderId: string; key: string; clientSecret: string };
    expect(placed.clientSecret).toMatch(/_secret_/);
    expect(await Shop.stockOf(harness, "desk-lamp")).toBe(3);

    // Stripe reports the payment; the order hears it through the queue.
    const charge = await Shop.chargeOf(harness, placed.orderId);
    expect(charge.amountCents).toBe(8800);
    expect((await Shop.succeed(harness, charge)).statusCode).toBe(200);
    await harness.settle();

    // The confirmation email carries the link a guest needs.
    expect(harness.mailer.sent).toHaveLength(1);
    const confirmation = harness.mailer.sent[0];
    expect(confirmation?.to).toBe("mari@example.com");
    expect(confirmation?.subject).toBe("Order #100001 confirmed");
    const link = /\/orders\/([0-9a-f-]+)\?key=([A-Za-z0-9_-]+)/.exec(confirmation?.text ?? "");
    expect(link?.[1]).toBe(placed.orderId);

    // That link opens the order with its lines, totals, payment and history.
    const order = jsonOf(await Shop.call(harness, "GET", `/orders/${link?.[1]}?key=${link?.[2]}`));
    expect(order).toMatchObject({
      number: 100001,
      status: "payment_successful",
      subtotalCents: 8800,
      shippingCents: 0,
      totalCents: 8800,
      payment: { status: "succeeded", card: { brand: "visa", last4: "4242" } },
      cancelable: true,
    });
    expect((order["events"] as { status: string }[]).map((event) => event.status)).toEqual([
      "pending_payment",
      "payment_successful",
    ]);

    // The bought products left the cart.
    expect(jsonOf(await Shop.call(harness, "GET", "/cart", guest))).toMatchObject({ itemCount: 0 });

    // Canceling before processing refunds the payment and restores the stock.
    harness.mailer.clear();
    const canceled = await Shop.call(harness, "POST", `/orders/${placed.orderId}/cancel?key=${placed.key}`, guest);
    expect(jsonOf(canceled)).toMatchObject({ status: "canceled" });
    await harness.settle();

    expect(jsonOf(await Shop.call(harness, "GET", `/orders/${placed.orderId}?key=${placed.key}`))).toMatchObject({
      status: "canceled",
      payment: { refund: "succeeded" },
    });
    expect(harness.gateway.calls.refund).toEqual([{ refundId: expect.any(String), intent: charge.intent, amountCents: 8800 }]);
    expect(harness.mailer.sent.map((email) => email.subject)).toEqual(["Order #100001 canceled", "Refund for order #100001"]);
    expect(await Shop.stockOf(harness, "desk-lamp")).toBe(5);
    expect(await Shop.stockOf(harness, "floor-lamp")).toBe(4);
  });
});
