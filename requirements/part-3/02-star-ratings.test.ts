/**
 * REQUIREMENTS_3.md: "Star rating system is implemented with the average
 * star rating calculated from all reviews."
 *
 * The reviews a product's average counts are its published ones: a review
 * waits for a moderator before it appears anywhere, the average included.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { Shop } from "../../apps/api/tests/support/commerce.ts"
import { jsonOf, seedCatalog, startHarness, type Harness } from "../../apps/api/tests/support/harness.ts"
import { Staff, type TestAccount } from "../../apps/api/tests/support/staff.ts"
import { Purchase } from "./support/purchase.ts"

let harness: Harness
let moderator: TestAccount
let delivery: TestAccount

beforeAll(async () => {
  harness = await startHarness()
}, 180_000)

afterAll(async () => {
  await harness.stop()
})

beforeEach(async () => {
  await harness.reset()
  // Four published reviews: 5, 4, 4 and 2 stars, an average of 3.75.
  await seedCatalog(harness, [{ slug: "desk-lamp", name: "Desk Lamp", priceCents: 2500, stock: 50, ratings: [5, 4, 4, 2] }])
  moderator = await Staff.account(harness, "moderator@example.com", ["moderator"])
  delivery = await Staff.account(harness, "delivery@example.com", ["delivery_manager"])
})

const ratingOf = async () => jsonOf(await Shop.call(harness, "GET", "/products/desk-lamp"))["rating"]

describe("a product's star rating", () => {
  it("is the average of all its reviews' stars, to one decimal, with how many there are", async () => {
    const reviews = jsonOf(await Shop.call(harness, "GET", "/products/desk-lamp/reviews"))
    const listed = jsonOf(await Shop.call(harness, "GET", "/products?q=desk"))["items"] as { slug: string; rating: unknown }[]

    expect(await ratingOf()).toEqual({ average: 3.8, count: 4 })
    expect(reviews).toMatchObject({ average: 3.8, count: 4, distribution: { "1": 0, "2": 1, "3": 0, "4": 2, "5": 1 } })
    expect(listed.find((item) => item.slug === "desk-lamp")?.rating).toEqual({ average: 3.8, count: 4 })
  })

  it("counts a new review as soon as it is published, and leaves out one still waiting", async () => {
    const buyer = await Purchase.deliverTo(harness, delivery, "buyer@example.com", "desk-lamp")
    const waiting = await Purchase.deliverTo(harness, delivery, "waiting@example.com", "desk-lamp")

    await Purchase.publishReview(harness, moderator, buyer, "desk-lamp", { rating: 1, authorName: "Mari", body: "It broke." })
    await Shop.call(harness, "PUT", "/products/desk-lamp/reviews/mine", { token: waiting }, { rating: 5, authorName: "Jaan" })

    // (5 + 4 + 4 + 2 + 1) / 5 = 3.2
    expect(await ratingOf()).toEqual({ average: 3.2, count: 5 })
  })

  it("is absent while a product has no reviews", async () => {
    await seedCatalog(harness, [{ slug: "floor-lamp", name: "Floor Lamp", priceCents: 8900 }])

    const product = jsonOf(await Shop.call(harness, "GET", "/products/floor-lamp"))

    expect(product["rating"]).toEqual({ count: 0 })
  })
})
