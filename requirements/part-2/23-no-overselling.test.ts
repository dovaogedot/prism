/**
 * REQUIREMENTS_2.md: "The inventory system prevents overselling during
 * concurrent payments."
 *
 * Its note: "Multiple simultaneous payments for the same product should not
 * result in overselling inventory"
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
  await seedCatalog(harness, [{ slug: "last-vase", name: "Last Vase", priceCents: 3000, stock: 3 }])
})

/** How many units every order that was paid for holds. */
const unitsSold = async (): Promise<number> => {
  const [row] = await harness.database.sql`
    SELECT coalesce(sum(l.quantity), 0)::int AS units
    FROM order_line l JOIN customer_order o ON o.id = l.order_id
    WHERE o.status = 'payment_successful'`
  return Number(row?.["units"])
}

describe("ten shoppers paying at once for the last three units", () => {
  it("lets exactly three of them pay, refuses the rest as sold out, and never sells more than the stock", async () => {
    const shoppers = await Promise.all(Array.from({ length: 10 }, () => Shop.fill(harness, [["last-vase", 1]])))

    const responses = await Promise.all(shoppers.map((shopper) => Shop.place(harness, shopper)))
    const placed = responses.filter((response) => response.statusCode === 201)
    const refused = responses.filter((response) => response.statusCode !== 201)

    expect(placed).toHaveLength(3)
    expect(refused).toHaveLength(7)
    for (const response of refused) {
      expect(response.statusCode).toBe(409)
      expect(jsonOf(response)["error"]).toMatchObject({ code: "OutOfStock", issues: [{ message: "Sold out." }] })
    }
    // Only the three that got a unit were ever charged.
    expect(harness.gateway.calls.createIntent).toHaveLength(3)

    // All three payments land at once.
    const charges = await Promise.all(placed.map((response) => Shop.chargeOf(harness, String(jsonOf(response)["orderId"]))))
    await Promise.all(charges.map((charge) => Shop.succeed(harness, charge)))
    await harness.settle()

    expect(await unitsSold()).toBe(3)
    expect(await Shop.stockOf(harness, "last-vase")).toBe(0)
  })
})
