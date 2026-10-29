/**
 * REQUIREMENTS_1.md: "Faceted search is implemented, allowing users to refine
 * results by product attributes (e.g., price range, brand, category)."
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { jsonOf, seedCatalog, startHarness, type Harness } from "../../apps/api/tests/support/harness.ts"

let harness: Harness

/** One selectable value of a facet and how many results it leads to. */
type Bucket = { value: string; count: number }

/** One page of results with its facets, as far as these checks read it. */
type Results = {
  total: number
  items: { slug: string }[]
  facets: {
    brands: Bucket[]
    price: { minCents: number; maxCents: number }
    properties: { name: string; buckets: Bucket[] }[]
  }
}

beforeAll(async () => {
  harness = await startHarness()
  await seedCatalog(harness, [
    { slug: "desk-lamp", name: "Desk Lamp", priceCents: 2500, category: "Lighting", brand: "Acme", properties: { color: "brass" } },
    { slug: "floor-lamp", name: "Floor Lamp", priceCents: 8000, category: "Lighting", brand: "Globex", properties: { color: "black" } },
    { slug: "candle", name: "Candle", priceCents: 900, category: "Lighting", brand: "Globex", properties: { color: "brass" } },
    { slug: "oak-desk", name: "Oak Desk", priceCents: 30_000, category: "Furniture", brand: "Acme", properties: { color: "brown" } },
    { slug: "desk-chair", name: "Desk Chair", priceCents: 12_000, category: "Furniture", brand: "Initech", properties: { color: "black" } },
  ])
}, 180_000)

afterAll(async () => {
  await harness.stop()
})

const search = async (query: string): Promise<Results> =>
  jsonOf(await harness.app.inject({ method: "GET", url: `/api/v1/products?${query}&perPage=60` })) as Results

const listSlugs = (results: Results): string[] => results.items.map((item) => item.slug).toSorted()

describe("refining results", () => {
  it("by a price range, in cents, both ends included", async () => {
    expect(listSlugs(await search("priceMin=2500&priceMax=12000"))).toEqual(["desk-chair", "desk-lamp", "floor-lamp"])
  })

  it("by one brand, or by any of several", async () => {
    expect(listSlugs(await search("brand=acme"))).toEqual(["desk-lamp", "oak-desk"])
    expect(listSlugs(await search("brand=acme&brand=initech"))).toEqual(["desk-chair", "desk-lamp", "oak-desk"])
  })

  it("by category", async () => {
    expect(listSlugs(await search("category=furniture"))).toEqual(["desk-chair", "oak-desk"])
  })

  it("by any other attribute a product carries", async () => {
    expect(listSlugs(await search("p.color=brass"))).toEqual(["candle", "desk-lamp"])
  })

  it("by several facets at once, each of which has to hold", async () => {
    expect(listSlugs(await search("category=lighting&brand=globex&priceMax=5000"))).toEqual(["candle"])
  })
})

describe("the facets offered", () => {
  it("count the results each value would leave, and give the price range of the results", async () => {
    const { facets } = await search("category=lighting")

    expect(facets.brands.map(({ value, count }) => ({ value, count }))).toEqual(
      expect.arrayContaining([
        { value: "acme", count: 1 },
        { value: "globex", count: 2 },
      ]),
    )
    expect(facets.brands).toHaveLength(2)
    expect(facets.price).toEqual({ minCents: 900, maxCents: 8000 })
    expect(facets.properties.find((facet) => facet.name === "color")?.buckets.map(({ value, count }) => ({ value, count }))).toEqual(
      expect.arrayContaining([
        { value: "brass", count: 2 },
        { value: "black", count: 1 },
      ]),
    )
  })
})
