/**
 * REQUIREMENTS_3.md: "Admins can manage delivery options and order status
 * updates."
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { Shop } from "../../apps/api/tests/support/commerce.ts"
import { jsonOf, registerUser, seedCatalog, startHarness, type Harness } from "../../apps/api/tests/support/harness.ts"
import { Staff, type TestAccount } from "../../apps/api/tests/support/staff.ts"
import { Purchase } from "./support/purchase.ts"

let harness: Harness
let admin: TestAccount

beforeAll(async () => {
  harness = await startHarness()
}, 180_000)

afterAll(async () => {
  await harness.stop()
})

beforeEach(async () => {
  await harness.reset()
  await seedCatalog(harness, [{ slug: "desk-lamp", name: "Desk Lamp", priceCents: 2500, stock: 50 }])
  admin = await Staff.account(harness, "admin@example.com", ["admin"])
})

const pigeon = { code: "pigeon", name: "Pigeon post", priceCents: 300, minDays: 3, maxDays: 5, isActive: true, position: 5 }

/** The delivery options checkout offers, by code. */
const offered = async () =>
  (jsonOf(await Shop.call(harness, "GET", "/shipping-methods"))["items"] as { code: string; name: string; priceCents: number }[]).map(
    (item) => [item.code, item.name, item.priceCents],
  )

describe("delivery options", () => {
  it("are added, edited, switched off and deleted, and checkout offers exactly the ones switched on", async () => {
    const created = await Staff.call(harness, admin, "POST", "/admin/shipping-methods", pigeon)
    expect(created.statusCode).toBe(201)
    expect(await offered()).toContainEqual(["pigeon", "Pigeon post", 300])

    await Staff.call(harness, admin, "PUT", "/admin/shipping-methods/pigeon", { ...pigeon, name: "Carrier pigeon", priceCents: 450 })
    expect(await offered()).toContainEqual(["pigeon", "Carrier pigeon", 450])

    await Staff.call(harness, admin, "PUT", "/admin/shipping-methods/pigeon", { ...pigeon, isActive: false })
    expect((await offered()).map(([code]) => code)).not.toContain("pigeon")

    expect((await Staff.call(harness, admin, "DELETE", "/admin/shipping-methods/pigeon")).statusCode).toBe(204)
    expect(
      (jsonOf(await Staff.call(harness, admin, "GET", "/admin/shipping-methods"))["items"] as { code: string }[]).map((item) => item.code),
    ).not.toContain("pigeon")
  })

  it("price an order placed with them", async () => {
    await Staff.call(harness, admin, "POST", "/admin/shipping-methods", pigeon)
    const caller = await Shop.fill(harness, [["desk-lamp", 1]])

    const placed = await Shop.place(harness, caller, { shippingMethod: "pigeon", expectedTotalCents: 2500 + 300 })

    expect(placed.statusCode).toBe(201)
    expect(jsonOf(await Staff.call(harness, admin, "GET", `/admin/orders/${String(jsonOf(placed)["orderId"])}`))).toMatchObject({
      shippingMethodName: "Pigeon post",
      shippingCents: 300,
    })
  })
})

describe("order status updates", () => {
  it("move a paid order to processing, shipped with its tracking number, and delivered, which the customer sees", async () => {
    const { accessToken } = await registerUser(harness, "buyer@example.com")
    const placed = await Purchase.placePaid(harness, { token: accessToken }, "desk-lamp")
    const customerView = async () => jsonOf(await Shop.call(harness, "GET", `/orders/${placed.orderId}`, { token: accessToken }))
    const statuses: unknown[] = []

    for (const step of [{ status: "processing" }, { status: "shipped", trackingNumber: "PR123456789EE" }, { status: "delivered" }]) {
      expect((await Staff.call(harness, admin, "POST", `/admin/orders/${placed.orderId}/status`, step)).statusCode).toBe(200)
      statuses.push((await customerView())["status"])
    }

    expect(statuses).toEqual(["processing", "shipped", "delivered"])
    expect(await customerView()).toMatchObject({ trackingNumber: "PR123456789EE" })
    expect(((await customerView())["events"] as { status: string }[]).map((event) => event.status)).toEqual([
      "pending_payment",
      "payment_successful",
      "processing",
      "shipped",
      "delivered",
    ])
    expect(harness.mailer.sent.map((email) => email.subject)).toEqual(
      expect.arrayContaining(["Order #100001 shipped", "Order #100001 delivered"]),
    )
  })

  it("refuses a step out of order", async () => {
    const placed = await Purchase.placePaid(harness, {}, "desk-lamp")

    const skipped = await Staff.call(harness, admin, "POST", `/admin/orders/${placed.orderId}/status`, { status: "delivered" })

    expect(jsonOf(skipped)["error"]).toMatchObject({ code: "OrderTransitionNotAllowed" })
  })
})
