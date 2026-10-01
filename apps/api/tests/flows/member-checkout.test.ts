/**
 * A signed-in customer over several visits: the cart survives signing out,
 * the second checkout is prefilled from the first, a declined card leaves
 * the cart to try again, and every order is in the order history.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PaymentFailure } from "@prism/shared";
import { Shop, type Caller } from "../support/commerce.ts";
import { jsonOf, registerUser, seedCatalog, startHarness, VALID_PASSWORD, type Harness } from "../support/harness.ts";

let harness: Harness;

beforeAll(async () => {
  harness = await startHarness();
  await harness.reset();
  await seedCatalog(harness, [
    { slug: "desk-lamp", name: "Desk Lamp", priceCents: 2500, stock: 10 },
    { slug: "oak-chair", name: "Oak Chair", priceCents: 12_000, stock: 3 },
  ]);
});

afterAll(async () => {
  await harness.stop();
});

const signIn = async (email: string): Promise<string> => {
  const response = await harness.app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    payload: { email, password: VALID_PASSWORD },
  });
  return (jsonOf(response)["grant"] as { accessToken: string }).accessToken;
};

describe("a returning customer", () => {
  it("keeps the cart across sessions, gets a prefilled checkout, recovers from a decline, and sees every order", async () => {
    const email = "regular@example.com";
    const { accessToken } = await registerUser(harness, email);
    await Shop.fill(harness, [["desk-lamp", 1]], { token: accessToken });

    // Signing out and in again on another device: the cart is the account's.
    await harness.app.inject({ method: "POST", url: "/api/v1/auth/logout", headers: { authorization: `Bearer ${accessToken}` } });
    let me: Caller = { token: await signIn(email) };
    expect(jsonOf(await Shop.call(harness, "GET", "/cart", me))).toMatchObject({ itemCount: 1 });

    // Before any order, the checkout knows only the account email.
    expect(jsonOf(await Shop.call(harness, "GET", "/checkout/prefill", me))).toEqual({ email });

    // The first order, paid.
    const first = await Shop.placed(harness, me);
    expect(first.key).toBeUndefined();
    await Shop.succeed(harness, first.charge);
    await harness.settle();

    // The next checkout starts from what the first order used.
    expect(jsonOf(await Shop.call(harness, "GET", "/checkout/prefill", me))).toMatchObject({
      contact: { fullName: "Mari Maasikas" },
      address: { city: "Tallinn", postalCode: "10117" },
      shippingMethod: "standard",
    });

    // A day later, the second order is declined for insufficient funds.
    harness.clock.advanceSeconds(24 * 60 * 60);
    me = { token: await signIn(email) };
    await Shop.fill(harness, [["oak-chair", 2]], me);
    const declined = await Shop.placed(harness, me);
    expect(await Shop.stockOf(harness, "oak-chair")).toBe(1);

    await Shop.decline(harness, declined.charge, "card_declined", "insufficient_funds");
    await harness.settle();

    expect(jsonOf(await Shop.call(harness, "GET", `/orders/${declined.orderId}`, me))).toMatchObject({
      status: "payment_failed",
      payment: { failure: "insufficient_funds" },
    });
    expect(harness.mailer.sent.at(-1)?.text).toContain(PaymentFailure.message.insufficient_funds);
    expect(await Shop.stockOf(harness, "oak-chair")).toBe(3);

    // The cart still holds the chairs, so the retry is one more order.
    expect(jsonOf(await Shop.call(harness, "GET", "/cart", me))).toMatchObject({ itemCount: 2 });
    const retried = await Shop.placed(harness, me);
    await Shop.succeed(harness, retried.charge);
    await harness.settle();

    // The history lists all three, newest first, and filters to the failure.
    const history = jsonOf(await Shop.call(harness, "GET", "/orders", me)) as { items: { number: number; status: string }[] };
    expect(history.items.map((item) => [item.number, item.status])).toEqual([
      [100003, "payment_successful"],
      [100002, "payment_failed"],
      [100001, "payment_successful"],
    ]);
    const failed = jsonOf(await Shop.call(harness, "GET", "/orders?status=payment_failed", me)) as { items: { number: number }[] };
    expect(failed.items.map((item) => item.number)).toEqual([100002]);

    expect(harness.mailer.sent.map((sent) => sent.subject)).toEqual([
      "Order #100001 confirmed",
      "Payment for order #100002 failed",
      "Order #100003 confirmed",
    ]);
  });
});
