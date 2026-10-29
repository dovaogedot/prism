/**
 * REQUIREMENTS_2.md: "Users can add, remove, and update quantities of items
 * in the cart with real-time total calculations."
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { Shop, type Caller } from "../../apps/api/tests/support/commerce.ts"
import { registerUser, seedCatalog, startHarness, type Harness } from "../../apps/api/tests/support/harness.ts"

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

type View = { lines: { slug: string; quantity: number; lineTotalCents: number }[]; itemCount: number; subtotalCents: number }

const viewOf = (response: { body: string }): View => JSON.parse(response.body) as View

/** The cart as each change answers it: lines as slug and quantity, the item count and the subtotal. */
const totalsOf = (view: View) => ({
  lines: view.lines.map((line) => [line.slug, line.quantity, line.lineTotalCents]),
  itemCount: view.itemCount,
  subtotalCents: view.subtotalCents,
})

describe.each([
  ["a guest", async (): Promise<Caller> => ({})],
  ["a member", async (): Promise<Caller> => ({ token: (await registerUser(harness, "member@example.com")).accessToken })],
] as const)("%s", (_who, callerOf) => {
  it("adds, updates and removes lines, and every answer carries the totals worked out again", async () => {
    const lamp = await Shop.productId(harness, "desk-lamp")
    const chair = await Shop.productId(harness, "oak-chair")
    const me = await Shop.fill(harness, [["desk-lamp", 1]], await callerOf())

    const added = viewOf(await Shop.call(harness, "POST", "/cart/items", me, { productId: chair, quantity: 2 }))
    expect(totalsOf(added)).toEqual({
      lines: [
        ["desk-lamp", 1, 2500],
        ["oak-chair", 2, 24_000],
      ],
      itemCount: 3,
      subtotalCents: 26_500,
    })

    const addedAgain = viewOf(await Shop.call(harness, "POST", "/cart/items", me, { productId: lamp, quantity: 2 }))
    expect(totalsOf(addedAgain)).toMatchObject({ itemCount: 5, subtotalCents: 31_500 })

    const updated = viewOf(await Shop.call(harness, "PUT", `/cart/items/${chair}`, me, { quantity: 1 }))
    expect(totalsOf(updated)).toEqual({
      lines: [
        ["desk-lamp", 3, 7500],
        ["oak-chair", 1, 12_000],
      ],
      itemCount: 4,
      subtotalCents: 19_500,
    })

    const removed = viewOf(await Shop.call(harness, "DELETE", `/cart/items/${lamp}`, me))
    expect(totalsOf(removed)).toEqual({ lines: [["oak-chair", 1, 12_000]], itemCount: 1, subtotalCents: 12_000 })

    expect(totalsOf(viewOf(await Shop.call(harness, "GET", "/cart", me)))).toEqual(totalsOf(removed))
  })
})

it("works the totals out from today's price, so a price change shows on the next read", async () => {
  const guest = await Shop.fill(harness, [["desk-lamp", 2]])
  expect(viewOf(await Shop.call(harness, "GET", "/cart", guest)).subtotalCents).toBe(5000)

  await harness.database.sql`UPDATE product SET price_cents = 2000 WHERE slug = 'desk-lamp'`

  expect(totalsOf(viewOf(await Shop.call(harness, "GET", "/cart", guest)))).toEqual({
    lines: [["desk-lamp", 2, 4000]],
    itemCount: 2,
    subtotalCents: 4000,
  })
})
