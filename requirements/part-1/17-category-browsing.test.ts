/**
 * REQUIREMENTS_1.md: "Products are organized into categories with an
 * intuitive browsing structure."
 *
 * The structure as the API serves the storefront: the list of categories the
 * shop menu shows, each category's own shelf, and the way back from a product
 * to its category and its neighbors there.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { jsonOf, seedCatalog, startHarness, type Harness } from "../../apps/api/tests/support/harness.ts"

let harness: Harness

/** A category as the shop menu lists it. */
type Category = { slug: string; name: string; productCount: number; image?: { url: string } }

beforeAll(async () => {
  harness = await startHarness()
  await seedCatalog(harness, [
    { slug: "desk-lamp", name: "Desk Lamp", priceCents: 2500, category: "Lighting", images: ["desk-lamp.png"] },
    { slug: "floor-lamp", name: "Floor Lamp", priceCents: 8000, category: "Lighting" },
    { slug: "candle", name: "Candle", priceCents: 900, category: "Lighting" },
    { slug: "oak-desk", name: "Oak Desk", priceCents: 30_000, category: "Furniture" },
    { slug: "desk-chair", name: "Desk Chair", priceCents: 12_000, category: "Furniture" },
    { slug: "iron-sword", name: "Iron Sword", priceCents: 1400, category: "Weapons" },
  ])
}, 180_000)

afterAll(async () => {
  await harness.stop()
})

const get = async (url: string): Promise<Record<string, unknown>> =>
  jsonOf(await harness.app.inject({ method: "GET", url: `/api/v1${url}` }))

const listSlugs = (body: Record<string, unknown>): string[] => (body["items"] as { slug: string }[]).map((item) => item.slug).toSorted()

describe("categories", () => {
  it("are listed by name, each with how many products it holds and a picture from one of them", async () => {
    const categories = (await get("/categories"))["items"] as Category[]

    expect(categories.map(({ slug, name, productCount }) => ({ slug, name, productCount }))).toEqual([
      { slug: "furniture", name: "Furniture", productCount: 2 },
      { slug: "lighting", name: "Lighting", productCount: 3 },
      { slug: "weapons", name: "Weapons", productCount: 1 },
    ])
    expect(categories.find((category) => category.slug === "lighting")?.image?.url).toBe("/media/desk-lamp.png")
  })

  it("each open on a shelf of exactly their own products", async () => {
    expect(listSlugs(await get("/products?category=lighting"))).toEqual(["candle", "desk-lamp", "floor-lamp"])
    expect(listSlugs(await get("/products?category=furniture"))).toEqual(["desk-chair", "oak-desk"])
  })

  it("narrow a search to the products of one category", async () => {
    expect(listSlugs(await get("/products?q=desk"))).toEqual(["desk-chair", "desk-lamp", "oak-desk"])
    expect(listSlugs(await get("/products?q=desk&category=furniture"))).toEqual(["desk-chair", "oak-desk"])
  })

  it("lead back from a product to its category, and on to the other products there", async () => {
    const product = await get("/products/floor-lamp")

    expect(product["category"]).toEqual({ slug: "lighting", name: "Lighting" })
    expect(listSlugs(await get("/products/floor-lamp/related"))).toEqual(["candle", "desk-lamp"])
  })
})
