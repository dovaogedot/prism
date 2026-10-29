/**
 * REQUIREMENTS_2.md: "The inventory system updates stock levels when orders
 * are placed or cancelled."
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { Shop } from "../../apps/api/tests/support/commerce.ts"
import { registerUser, seedCatalog, startHarness, type Harness } from "../../apps/api/tests/support/harness.ts"
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
    { slug: "desk-lamp", name: "Desk Lamp", priceCents: 2500, stock: 10 },
    { slug: "oak-chair", name: "Oak Chair", priceCents: 12_000, stock: 4 },
  ])
})

const stock = async () => ({ lamps: await Shop.stockOf(harness, "desk-lamp"), chairs: await Shop.stockOf(harness, "oak-chair") })

/** An order of three lamps and two chairs, placed by a signed-in customer. */
const placedOrder = async () => {
  const { accessToken } = await registerUser(harness, "buyer@example.com")
  const placed = await Shop.placed(
    harness,
    await Shop.fill(
      harness,
      [
        ["desk-lamp", 3],
        ["oak-chair", 2],
      ],
      { token: accessToken },
    ),
  )

  return { placed, token: accessToken }
}

describe("placing an order", () => {
  it("takes each line's quantity off its product's stock", async () => {
    await placedOrder()

    expect(await stock()).toEqual({ lamps: 7, chairs: 2 })
  })

  it("keeps it off once the order is paid", async () => {
    const { placed } = await placedOrder()
    await Shop.succeed(harness, placed.charge)
    await harness.settle()

    expect(await stock()).toEqual({ lamps: 7, chairs: 2 })
  })
})

describe("canceling an order", () => {
  it("puts the stock back when the customer cancels before paying", async () => {
    const { placed, token } = await placedOrder()

    expect((await Shop.call(harness, "POST", `/orders/${placed.orderId}/cancel`, { token })).statusCode).toBe(200)
    await harness.settle()

    expect(await stock()).toEqual({ lamps: 10, chairs: 4 })
  })

  it("puts the stock back when the customer cancels a paid order", async () => {
    const { placed, token } = await placedOrder()
    await Shop.succeed(harness, placed.charge)
    await harness.settle()

    expect((await Shop.call(harness, "POST", `/orders/${placed.orderId}/cancel`, { token })).statusCode).toBe(200)
    await harness.settle()

    expect(await stock()).toEqual({ lamps: 10, chairs: 4 })
  })

  it("puts the stock back when the shop cancels an order it is processing", async () => {
    const { placed } = await placedOrder()
    await Shop.succeed(harness, placed.charge)
    await harness.settle()
    const delivery = await Staff.account(harness, "delivery@example.com", ["delivery_manager"])
    const support = await Staff.account(harness, "support@example.com", ["support"])
    await Staff.call(harness, delivery, "POST", `/admin/orders/${placed.orderId}/status`, { status: "processing" })

    expect((await Staff.call(harness, support, "POST", `/admin/orders/${placed.orderId}/cancel`)).statusCode).toBe(200)
    await harness.settle()

    expect(await stock()).toEqual({ lamps: 10, chairs: 4 })
  })

  it("puts the stock back when an unpaid order runs out of time and is canceled", async () => {
    await placedOrder()

    harness.clock.advanceSeconds(harness.config.commerce.paymentWindowSeconds)
    expect((await harness.jobs.housekeeping.run()).expired).toBe(1)
    await harness.settle()

    expect(await stock()).toEqual({ lamps: 10, chairs: 4 })
  })

  it("puts the stock back once only, however often it is asked", async () => {
    const { placed, token } = await placedOrder()

    await Shop.call(harness, "POST", `/orders/${placed.orderId}/cancel`, { token })
    await Shop.call(harness, "POST", `/orders/${placed.orderId}/cancel`, { token })
    await harness.settle()

    expect(await stock()).toEqual({ lamps: 10, chairs: 4 })
  })
})
