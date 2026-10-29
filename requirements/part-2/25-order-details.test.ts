/**
 * REQUIREMENTS_2.md: "The order details page displays full order information
 * including status updates."
 *
 * The page draws what `GET /orders/:id` answers, so the answer is checked.
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
  await seedCatalog(harness, [
    { slug: "desk-lamp", name: "Desk Lamp", priceCents: 2500, stock: 10, images: ["lamp.png"] },
    { slug: "oak-chair", name: "Oak Chair", priceCents: 12_000, stock: 10 },
  ])
})

describe("an order's details", () => {
  it("hold who and where it goes to, what was bought at what price, the delivery, the payment and every status it went through", async () => {
    const { accessToken } = await registerUser(harness, "buyer@example.com")
    const me = await Shop.fill(
      harness,
      [
        ["desk-lamp", 2],
        ["oak-chair", 1],
      ],
      { token: accessToken },
    )
    const placed = await Shop.placed(harness, me)
    await Shop.succeed(harness, placed.charge)
    await harness.settle()

    const delivery = await Staff.account(harness, "delivery@example.com", ["delivery_manager"])
    const step = (body: object) => Staff.call(harness, delivery, "POST", `/admin/orders/${placed.orderId}/status`, body)
    expect((await step({ status: "processing" })).statusCode).toBe(200)
    expect((await step({ status: "shipped", trackingNumber: "PR123456789EE" })).statusCode).toBe(200)

    const detail = jsonOf(await Shop.call(harness, "GET", `/orders/${placed.orderId}`, { token: accessToken }))

    expect(detail).toMatchObject({
      id: placed.orderId,
      number: placed.number,
      status: "shipped",
      createdAt: expect.any(String),
      contact: { fullName: "Mari Maasikas", email: "mari@example.com", phone: "+37251234567" },
      address: { line1: "Narva mnt 7", city: "Tallinn", postalCode: "10117", country: "EE" },
      shippingMethod: "standard",
      shippingMethodName: "Standard",
      estimatedDelivery: { from: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), to: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) },
      lines: [
        {
          slug: "desk-lamp",
          name: "Desk Lamp",
          image: { url: "/media/lamp.png" },
          unitPriceCents: 2500,
          quantity: 2,
          lineTotalCents: 5000,
        },
        { slug: "oak-chair", name: "Oak Chair", unitPriceCents: 12_000, quantity: 1, lineTotalCents: 12_000 },
      ],
      subtotalCents: 17_000,
      shippingCents: 0,
      totalCents: 17_000,
      payment: { status: "succeeded", reference: placed.charge.intent, card: { brand: "visa", last4: "4242" } },
      trackingNumber: "PR123456789EE",
      cancelable: false,
    })
    expect((detail["events"] as { status: string; at: string }[]).map((event) => event.status)).toEqual([
      "pending_payment",
      "payment_successful",
      "processing",
      "shipped",
    ])
    for (const event of detail["events"] as { at: string }[]) {
      expect(Number.isNaN(Date.parse(event.at)), event.at).toBe(false)
    }
  })

  it("show a failed payment's reason among the status updates", async () => {
    const placed = await Shop.placed(harness, await Shop.fill(harness, [["desk-lamp", 1]]))
    await Shop.decline(harness, placed.charge, "card_declined", "insufficient_funds")
    await harness.settle()

    const detail = jsonOf(await Shop.call(harness, "GET", `/orders/${placed.orderId}?key=${placed.key}`))

    expect(detail).toMatchObject({ status: "payment_failed", payment: { status: "failed", failure: "insufficient_funds" } })
    expect(detail["events"]).toEqual([
      expect.objectContaining({ status: "pending_payment" }),
      expect.objectContaining({ status: "payment_failed", note: "Your card has insufficient funds. Try another card." }),
    ])
  })

  it("are only shown to the order's owner, or with the key from the guest's email", async () => {
    const owner = await registerUser(harness, "owner@example.com")
    const other = await registerUser(harness, "other@example.com")
    const members = await Shop.placed(harness, await Shop.fill(harness, [["desk-lamp", 1]], { token: owner.accessToken }))
    const guests = await Shop.placed(harness, await Shop.fill(harness, [["desk-lamp", 1]]))

    expect((await Shop.call(harness, "GET", `/orders/${members.orderId}`, { token: other.accessToken })).statusCode).toBe(404)
    expect((await Shop.call(harness, "GET", `/orders/${guests.orderId}`)).statusCode).toBe(404)
    expect((await Shop.call(harness, "GET", `/orders/${guests.orderId}?key=${guests.key}`)).statusCode).toBe(200)
  })
})
