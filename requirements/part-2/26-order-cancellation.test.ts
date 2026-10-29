/**
 * REQUIREMENTS_2.md: "The order cancellation system allows cancellations for
 * unprocessed orders."
 *
 * Unprocessed is an order nobody has started to fulfill: waiting for its
 * payment, or paid and not yet processing.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { Shop } from "../../apps/api/tests/support/commerce.ts"
import { jsonOf, registerUser, seedCatalog, startHarness, type Harness } from "../../apps/api/tests/support/harness.ts"
import { Staff } from "../../apps/api/tests/support/staff.ts"

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

type Detail = {
  status: string
  cancelable: boolean
  events: { status: string; note?: string }[]
  payment: { status: string; refund?: string }
}

/** A signed-in customer's order, paid for when `isPaid`. */
const orderOf = async (isPaid: boolean) => {
  const { accessToken } = await registerUser(harness, "buyer@example.com")
  const placed = await Shop.placed(harness, await Shop.fill(harness, [["desk-lamp", 1]], { token: accessToken }))
  if (isPaid) {
    await Shop.succeed(harness, placed.charge)
    await harness.settle()
  }

  const detail = async (): Promise<Detail> =>
    jsonOf(await Shop.call(harness, "GET", `/orders/${placed.orderId}`, { token: accessToken })) as unknown as Detail
  const cancel = () => Shop.call(harness, "POST", `/orders/${placed.orderId}/cancel`, { token: accessToken })

  return { placed, detail, cancel }
}

describe("an order waiting for its payment", () => {
  it("can be canceled, which stops the payment", async () => {
    const order = await orderOf(false)
    expect(await order.detail()).toMatchObject({ status: "pending_payment", cancelable: true })

    const response = await order.cancel()
    await harness.settle()

    expect(response.statusCode).toBe(200)
    expect(await order.detail()).toMatchObject({ status: "canceled", cancelable: false, payment: { status: "canceled" } })
    expect(harness.gateway.calls.cancelIntent).toEqual([order.placed.charge.intent])
  })

  it("can be canceled by a guest with the key from the email", async () => {
    const placed = await Shop.placed(harness, await Shop.fill(harness, [["desk-lamp", 1]]))

    expect((await Shop.call(harness, "POST", `/orders/${placed.orderId}/cancel`)).statusCode).toBe(404)
    expect(jsonOf(await Shop.call(harness, "POST", `/orders/${placed.orderId}/cancel?key=${placed.key}`))).toMatchObject({
      status: "canceled",
    })
  })
})

describe("a paid order nobody has started processing", () => {
  it("can be canceled, and the payment is refunded in full", async () => {
    const order = await orderOf(true)
    expect(await order.detail()).toMatchObject({ status: "payment_successful", cancelable: true })

    expect((await order.cancel()).statusCode).toBe(200)
    await harness.settle()

    const detail = await order.detail()
    expect(detail).toMatchObject({ status: "canceled", payment: { status: "succeeded", refund: "succeeded" } })
    expect(detail.events.map((event) => event.note ?? event.status)).toEqual([
      "pending_payment",
      "payment_successful",
      "Canceled by the customer",
      "Refund issued",
    ])
    expect(harness.gateway.calls.refund).toEqual([
      { refundId: expect.any(String), intent: order.placed.charge.intent, amountCents: order.placed.charge.amountCents },
    ])
  })
})

describe("an order the shop has started on", () => {
  it.each([
    ["processing", [{ status: "processing" }]],
    ["shipped", [{ status: "processing" }, { status: "shipped", trackingNumber: "PR123456789EE" }]],
  ] as const)("cannot be canceled once %s, and stays as it was", async (status, steps) => {
    const order = await orderOf(true)
    const delivery = await Staff.account(harness, "delivery@example.com", ["delivery_manager"])
    for (const step of steps) {
      expect((await Staff.call(harness, delivery, "POST", `/admin/orders/${order.placed.orderId}/status`, step)).statusCode).toBe(200)
    }
    expect(await order.detail()).toMatchObject({ status, cancelable: false })

    const response = await order.cancel()
    await harness.settle()

    expect(response.statusCode).toBe(409)
    expect(jsonOf(response)["error"]).toMatchObject({ code: "OrderNotCancelable", message: "This order can no longer be canceled." })
    expect((await order.detail()).status).toBe(status)
    expect(harness.gateway.calls.refund).toEqual([])
  })
})
