/**
 * REQUIREMENTS_3.md: "The review sorting system orders reviews by
 * helpfulness votes."
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { Shop } from "../../apps/api/tests/support/commerce.ts"
import { jsonOf, registerUser, seedCatalog, startHarness, type Harness } from "../../apps/api/tests/support/harness.ts"
import { Staff } from "../../apps/api/tests/support/staff.ts"
import { Purchase } from "./support/purchase.ts"

let harness: Harness

beforeAll(async () => {
  harness = await startHarness()
}, 180_000)

afterAll(async () => {
  await harness.stop()
})

beforeEach(async () => {
  await harness.reset()
  await seedCatalog(harness, [{ slug: "desk-lamp", name: "Desk Lamp", priceCents: 2500, stock: 50 }])
})

/** The bylines of the product's reviews, in the order the product page lists them by default. */
const bylines = async (): Promise<readonly string[]> =>
  (jsonOf(await Shop.call(harness, "GET", "/products/desk-lamp/reviews"))["items"] as { authorName: string }[]).map(
    (item) => item.authorName,
  )

/** Marks review `id` helpful once from each of `voters`. */
const vote = async (id: string, voters: readonly string[]): Promise<void> => {
  for (const voter of voters) {
    expect((await Shop.call(harness, "PUT", `/reviews/${id}/vote`, { token: voter })).statusCode).toBe(204)
  }
}

describe("the order of a product's reviews", () => {
  it("puts the review most voted helpful first, and follows the votes as they change", async () => {
    const moderator = await Staff.account(harness, "moderator@example.com", ["moderator"])
    const delivery = await Staff.account(harness, "delivery@example.com", ["delivery_manager"])
    const ids = new Map<string, string>()

    // Written oldest to newest, with ratings that sort neither way the votes do.
    for (const [name, rating] of [
      ["Ann", 5],
      ["Ben", 1],
      ["Cid", 3],
    ] as const) {
      const token = await Purchase.deliverTo(harness, delivery, `${name.toLowerCase()}@example.com`, "desk-lamp")
      ids.set(name, await Purchase.publishReview(harness, moderator, token, "desk-lamp", { rating, authorName: name }))
      harness.clock.advanceSeconds(60)
    }

    const voters = await Promise.all(
      ["one", "two", "three", "four"].map(async (name) => (await registerUser(harness, `${name}@example.com`)).accessToken),
    )

    await vote(ids.get("Ben") ?? "", voters.slice(0, 2))
    await vote(ids.get("Ann") ?? "", voters.slice(0, 1))
    expect(await bylines()).toEqual(["Ben", "Ann", "Cid"])

    await vote(ids.get("Ann") ?? "", voters.slice(1))
    expect(await bylines()).toEqual(["Ann", "Ben", "Cid"])
  })
})
