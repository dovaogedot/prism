/**
 * REQUIREMENTS_2.md: "A guest cart is implemented for non-registered users,
 * saving their selections temporarily."
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { Shop } from "../../apps/api/tests/support/commerce.ts"
import { requiredCookie, seedCatalog, startHarness, type Harness } from "../../apps/api/tests/support/harness.ts"

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
    { slug: "oak-chair", name: "Oak Chair", priceCents: 12_000, stock: 10 },
  ])
})

const itemCountOf = async (guest: string | undefined): Promise<number> =>
  (JSON.parse((await Shop.call(harness, "GET", "/cart", guest === undefined ? {} : { guest })).body) as { itemCount: number }).itemCount

describe("a visitor without an account", () => {
  it("gets a cart behind a cookie on the first add, which later requests find again", async () => {
    const added = await Shop.call(
      harness,
      "POST",
      "/cart/items",
      {},
      { productId: await Shop.productId(harness, "desk-lamp"), quantity: 2 },
    )
    const guest = requiredCookie(added, "prism_cart")

    expect(added.cookies.find((cookie) => cookie.name === "prism_cart")).toMatchObject({ httpOnly: true, path: "/api/v1" })
    expect(await itemCountOf(guest)).toBe(2)

    await Shop.fill(harness, [["oak-chair", 1]], { guest })
    expect(await itemCountOf(guest)).toBe(3)
  })

  it("keeps a cart of their own, which another visitor does not see", async () => {
    const first = await Shop.fill(harness, [["desk-lamp", 1]])
    const second = await Shop.fill(harness, [["oak-chair", 4]])

    expect(await itemCountOf(first.guest)).toBe(1)
    expect(await itemCountOf(second.guest)).toBe(4)
    expect(await itemCountOf(undefined)).toBe(0)
  })
})

describe("the guest cart", () => {
  it("is kept for the guest cart lifetime after the last change, and its cookie lasts as long", async () => {
    const ttlSeconds = harness.config.commerce.guestCartTtlSeconds
    const added = await Shop.call(
      harness,
      "POST",
      "/cart/items",
      {},
      { productId: await Shop.productId(harness, "desk-lamp"), quantity: 1 },
    )
    const guest = requiredCookie(added, "prism_cart")
    const cookie = added.cookies.find((candidate) => candidate.name === "prism_cart")

    expect(cookie?.expires?.getTime()).toBe(Math.floor((harness.clock.now().getTime() + ttlSeconds * 1000) / 1000) * 1000)

    harness.clock.advanceSeconds(ttlSeconds - 1)
    expect(await itemCountOf(guest)).toBe(1)
  })

  it("is gone once that lifetime passes without a change, and housekeeping deletes it", async () => {
    const { guest } = await Shop.fill(harness, [["desk-lamp", 1]])
    harness.clock.advanceSeconds(harness.config.commerce.guestCartTtlSeconds + 1)

    expect(await itemCountOf(guest)).toBe(0)
    expect((await harness.jobs.housekeeping.run()).cartsDeleted).toBe(1)
    expect(await harness.database.sql`SELECT id FROM cart`).toEqual([])
  })
})
