/**
 * REQUIREMENTS_2.md: "The order system updates status appropriately upon
 * receiving callbacks from payment provider (successful or failed payments)."
 *
 * The callbacks are Stripe's webhooks, signed the way Stripe signs them.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
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

type Detail = { status: string; events: { status: string; note?: string }[]; payment: { status: string; failure?: string } }

const placedOrder = async () => Shop.placed(harness, await Shop.fill(harness, [["desk-lamp", 1]]))

const detailOf = async (placed: { orderId: string; key?: string }): Promise<Detail> =>
  jsonOf(await Shop.call(harness, "GET", `/orders/${placed.orderId}?key=${placed.key}`)) as unknown as Detail

describe("an order waiting for its payment", () => {
  it("becomes payment successful when the provider says the payment succeeded", async () => {
    const placed = await placedOrder()
    expect((await detailOf(placed)).status).toBe("pending_payment")

    expect((await Shop.succeed(harness, placed.charge)).statusCode).toBe(200)
    await harness.settle()

    const detail = await detailOf(placed)
    expect(detail).toMatchObject({ status: "payment_successful", payment: { status: "succeeded" } })
    expect(detail.events.map((event) => event.status)).toEqual(["pending_payment", "payment_successful"])
  })

  it("becomes payment failed, with the reason, when the provider says the payment failed", async () => {
    const placed = await placedOrder()

    expect((await Shop.decline(harness, placed.charge, "expired_card")).statusCode).toBe(200)
    await harness.settle()

    const detail = await detailOf(placed)
    expect(detail).toMatchObject({ status: "payment_failed", payment: { status: "failed", failure: "expired_card" } })
    expect(detail.events.at(-1)).toMatchObject({
      status: "payment_failed",
      note: "Your card has expired. Check the expiry date or use another card.",
    })
  })

  it("changes once when the provider sends the same callback again", async () => {
    const placed = await placedOrder()

    await Shop.succeed(harness, placed.charge)
    await harness.settle()
    await Shop.succeed(harness, placed.charge)
    await harness.settle()

    expect((await detailOf(placed)).events.map((event) => event.status)).toEqual(["pending_payment", "payment_successful"])
  })

  it("ignores a callback whose signature does not check out", async () => {
    const placed = await placedOrder()
    const { payload } = harness.gateway.sign({ type: "payment_intent.succeeded", object: Shop.intent(placed.charge) })

    const response = await harness.app.inject({
      method: "POST",
      url: "/api/v1/payments/webhook",
      headers: { "content-type": "application/json", "stripe-signature": "t=1,v1=0000" },
      payload,
    })
    await harness.settle()

    expect(response.statusCode).toBe(400)
    expect((await detailOf(placed)).status).toBe("pending_payment")
  })
})
