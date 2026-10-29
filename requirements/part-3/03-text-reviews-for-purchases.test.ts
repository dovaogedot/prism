/**
 * REQUIREMENTS_3.md: "The review system allows users to submit text reviews
 * for purchased products."
 *
 * A product counts as purchased once its order is delivered: the shop asks
 * for a review when the parcel arrives.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { Shop } from "../../apps/api/tests/support/commerce.ts"
import { jsonOf, registerUser, seedCatalog, startHarness, type Harness } from "../../apps/api/tests/support/harness.ts"
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
  await seedCatalog(harness, [
    { slug: "desk-lamp", name: "Desk Lamp", priceCents: 2500, stock: 50 },
    { slug: "floor-lamp", name: "Floor Lamp", priceCents: 8900, stock: 50 },
  ])
  moderator = await Staff.account(harness, "moderator@example.com", ["moderator"])
  delivery = await Staff.account(harness, "delivery@example.com", ["delivery_manager"])
})

const review = { rating: 4, authorName: "Mari", title: "Bright and steady", body: "Lights the whole desk without a flicker." }

const write = (token: string, slug: string) => Shop.call(harness, "PUT", `/products/${slug}/reviews/mine`, { token }, review)

const canReview = async (token: string, slug: string) =>
  jsonOf(await Shop.call(harness, "GET", `/products/${slug}/reviews/viewer`, { token }))["canReview"]

describe("a text review", () => {
  it("is taken from a customer who bought the product, and published with its text", async () => {
    const buyer = await Purchase.deliverTo(harness, delivery, "buyer@example.com", "desk-lamp")

    expect(await canReview(buyer, "desk-lamp")).toBe(true)
    const id = await Purchase.publishReview(harness, moderator, buyer, "desk-lamp", review)

    const page = jsonOf(await Shop.call(harness, "GET", "/products/desk-lamp/reviews"))
    expect(page["items"]).toEqual([expect.objectContaining({ id, ...review })])
  })

  it("is refused for a product the customer did not buy, also when they bought another", async () => {
    const buyer = await Purchase.deliverTo(harness, delivery, "buyer@example.com", "desk-lamp")

    const response = await write(buyer, "floor-lamp")

    expect(await canReview(buyer, "floor-lamp")).toBe(false)
    expect(response.statusCode).toBe(403)
    expect(jsonOf(response)["error"]).toMatchObject({ code: "ReviewNotAllowed" })
  })

  it("is refused for a customer who never ordered, and for a guest", async () => {
    const { accessToken } = await registerUser(harness, "browser@example.com")

    expect((await write(accessToken, "desk-lamp")).statusCode).toBe(403)
    expect((await Shop.call(harness, "PUT", "/products/desk-lamp/reviews/mine", {}, review)).statusCode).toBe(401)
    expect(await harness.database.sql`SELECT id FROM product_review`).toHaveLength(0)
  })
})
