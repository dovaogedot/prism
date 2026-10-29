/**
 * REQUIREMENTS_2.md: "The payment system responds to specific failure
 * scenarios."
 *
 * Its note: "System must handle: insufficient funds error, invalid card
 * number error, expired card error, and payment gateway timeout"
 *
 * The declines are the codes Stripe's webhooks carry for its test cards:
 * insufficient_funds, incorrect_number and expired_card.
 */

import Stripe from "stripe"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { PaymentGateway } from "../../apps/api/src/platform/payment-gateway.ts"
import { Shop } from "../../apps/api/tests/support/commerce.ts"
import { jsonOf, seedCatalog, startHarness, type Harness } from "../../apps/api/tests/support/harness.ts"

let harness: Harness

beforeAll(async () => {
  harness = await startHarness()
}, 180_000)

afterAll(async () => {
  await harness.stop()
})

beforeEach(async () => {
  await harness.reset()
  await seedCatalog(harness, [{ slug: "desk-lamp", name: "Desk Lamp", priceCents: 2500, stock: 10 }])
})

describe.each([
  [
    "insufficient funds",
    "card_declined",
    "insufficient_funds",
    "insufficient_funds",
    "Your card has insufficient funds. Try another card.",
  ],
  ["an invalid card number", "incorrect_number", undefined, "incorrect_number", "The card number is incorrect."],
  ["an expired card", "expired_card", undefined, "expired_card", "Your card has expired. Check the expiry date or use another card."],
] as const)("a decline for %s", (_scenario, code, declineCode, failure, message) => {
  it("fails the order with its own reason, gives the stock back, cancels the intent and keeps the cart for another try", async () => {
    const guest = await Shop.fill(harness, [["desk-lamp", 2]])
    const placed = await Shop.placed(harness, guest)
    expect(await Shop.stockOf(harness, "desk-lamp")).toBe(8)

    expect((await Shop.decline(harness, placed.charge, code, declineCode)).statusCode).toBe(200)
    await harness.settle()

    const order = jsonOf(await Shop.call(harness, "GET", `/orders/${placed.orderId}?key=${placed.key}`))
    expect(order).toMatchObject({ status: "payment_failed", cancelable: false, payment: { status: "failed", failure } })
    expect(order["events"]).toContainEqual(expect.objectContaining({ status: "payment_failed", note: message }))
    expect(await Shop.stockOf(harness, "desk-lamp")).toBe(10)
    expect(harness.gateway.calls.cancelIntent).toEqual([placed.charge.intent])
    expect(harness.mailer.sent[0]?.text).toContain(message)
    expect(JSON.parse((await Shop.call(harness, "GET", "/cart", guest)).body)).toMatchObject({ itemCount: 2 })
  })
})

describe("a payment gateway timeout", () => {
  it("answers at once that the provider did not answer, fails the order and gives the stock back", async () => {
    harness.gateway.failNext("createIntent", "gateway_timeout")
    const guest = await Shop.fill(harness, [["desk-lamp", 1]])

    const response = await Shop.place(harness, guest)

    expect(response.statusCode).toBe(504)
    expect(jsonOf(response)["error"]).toEqual({
      code: "PaymentGatewayUnavailable",
      message: "The payment provider did not answer. You have not been charged.",
      issues: [],
    })

    await harness.settle()

    const [order] = await harness.database.sql`SELECT status FROM customer_order`
    const [payment] = await harness.database.sql`SELECT status FROM payment`
    expect(order).toEqual({ status: "payment_failed" })
    expect(payment).toEqual({ status: "failed" })
    expect(await Shop.stockOf(harness, "desk-lamp")).toBe(10)
    expect(JSON.parse((await Shop.call(harness, "GET", "/cart", guest)).body)).toMatchObject({ itemCount: 1 })
  })

  it("is what the shop's Stripe client makes of a request that got no answer", () => {
    const noAnswer = new Stripe.errors.StripeConnectionError({ message: "Request aborted due to timeout being reached (10000ms)" })

    expect(PaymentGateway.failureOfError(noAnswer)).toBe("gateway_timeout")
  })
})
