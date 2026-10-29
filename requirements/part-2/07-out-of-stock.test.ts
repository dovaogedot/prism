/**
 * REQUIREMENTS_2.md: "The system handles out-of-stock scenarios gracefully
 * when users attempt to add items to the cart."
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { Shop, type Caller } from "../../apps/api/tests/support/commerce.ts"
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
  await seedCatalog(harness, [
    { slug: "wall-lamp", name: "Wall Lamp", priceCents: 4000, stock: 0 },
    { slug: "oak-chair", name: "Oak Chair", priceCents: 12_000, stock: 2 },
  ])
})

const add = async (slug: string, quantity: number, caller: Caller = {}) =>
  Shop.call(harness, "POST", "/cart/items", caller, {
    productId: await Shop.productId(harness, slug),
    quantity,
  })

describe("a sold-out product", () => {
  it("shows no stock on its page, so the page can say it is sold out", async () => {
    expect(jsonOf(await Shop.call(harness, "GET", "/products/wall-lamp"))).toMatchObject({ name: "Wall Lamp", stock: 0 })
  })

  it("is refused with a sentence saying so, and no cart is started for it", async () => {
    const response = await add("wall-lamp", 1)

    expect(response.statusCode).toBe(409)
    expect(jsonOf(response)["error"]).toEqual({
      code: "OutOfStock",
      message: "Some items are not available in the quantity you asked for.",
      issues: [{ path: await Shop.productId(harness, "wall-lamp"), message: "Sold out." }],
    })
    expect(response.cookies).toEqual([])
    expect(await harness.database.sql`SELECT id FROM cart`).toEqual([])
  })
})

describe("more than the stock", () => {
  it("is refused with how many are left, and the cart keeps what it had", async () => {
    const me = await Shop.fill(harness, [["oak-chair", 1]])
    const chair = await Shop.productId(harness, "oak-chair")

    const added = await add("oak-chair", 2, me)
    const set = await Shop.call(harness, "PUT", `/cart/items/${chair}`, me, { quantity: 5 })

    for (const response of [added, set]) {
      expect(response.statusCode).toBe(409)
      expect(jsonOf(response)["error"]).toMatchObject({ code: "OutOfStock", issues: [{ path: chair, message: "Only 2 left." }] })
    }
    expect(JSON.parse((await Shop.call(harness, "GET", "/cart", me)).body)).toMatchObject({
      lines: [{ slug: "oak-chair", quantity: 1, stock: 2 }],
      itemCount: 1,
    })
  })

  it("is allowed up to exactly the stock", async () => {
    const response = await add("oak-chair", 2)

    expect(response.statusCode).toBe(200)
    expect(JSON.parse(response.body)).toMatchObject({ itemCount: 2 })
  })
})
