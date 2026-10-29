/**
 * REQUIREMENTS_1.md: "Product listing includes sorting options for relevance,
 * price and rating."
 */

import { readFileSync } from "node:fs"
import { ProductSort } from "@prism/shared"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { jsonOf, seedCatalog, startHarness, type Harness } from "../../apps/api/tests/support/harness.ts"

let harness: Harness

beforeAll(async () => {
  harness = await startHarness()
  await seedCatalog(harness, [
    { slug: "lamp-shade", name: "Lamp Shade", description: "Linen, for any lamp.", priceCents: 1500, ratings: [3] },
    { slug: "desk-lamp", name: "Desk Lamp", description: "A brass lamp for a desk.", priceCents: 2500, ratings: [5, 4] },
    { slug: "lamp", name: "Lamp", description: "Just a lamp.", priceCents: 1900 },
    { slug: "floor-lamp", name: "Floor Lamp", description: "Tall and bright.", priceCents: 8000, ratings: [5] },
    { slug: "candle", name: "Candle", description: "Wax, for when the lamp is off.", priceCents: 900, ratings: [2, 2] },
  ])
}, 180_000)

afterAll(async () => {
  await harness.stop()
})

const fetchListing = async (query: string): Promise<string[]> =>
  (jsonOf(await harness.app.inject({ method: "GET", url: `/api/v1/products?${query}` }))["items"] as { slug: string }[]).map(
    (item) => item.slug,
  )

describe("the product listing", () => {
  it("offers relevance, both price orders and rating in the listing page's sort menu", () => {
    const listingPage = readFileSync(new URL("../../apps/web/src/features/catalog/pages/ListingPage.tsx", import.meta.url), "utf8")

    expect(listingPage).toMatch(/ProductSort\.NAMES\.map\(/)
    expect(ProductSort.NAMES).toEqual(expect.arrayContaining(["relevance", "price_asc", "price_desc", "rating"]))
    expect([ProductSort.label.price_asc, ProductSort.label.price_desc, ProductSort.label.rating]).toEqual([
      "Price: low to high",
      "Price: high to low",
      "Top rated",
    ])
  })

  it("sorts by relevance to the searched text: the product named exactly that first, one that only mentions it last", async () => {
    const byRelevance = await fetchListing("q=lamp&sort=relevance")

    expect(byRelevance[0]).toBe("lamp")
    expect(byRelevance.at(-1)).toBe("candle")
  })

  it("sorts by price, cheapest first or dearest first", async () => {
    expect(await fetchListing("sort=price_asc")).toEqual(["candle", "lamp-shade", "lamp", "desk-lamp", "floor-lamp"])
    expect(await fetchListing("sort=price_desc")).toEqual(["floor-lamp", "desk-lamp", "lamp", "lamp-shade", "candle"])
  })

  it("sorts by rating, best rated first and unrated last", async () => {
    expect(await fetchListing("sort=rating")).toEqual(["floor-lamp", "desk-lamp", "lamp-shade", "candle", "lamp"])
  })

  it("keeps a search's matches, only reordered, in every sort", async () => {
    const matches = (await fetchListing("q=lamp")).toSorted()

    for (const sort of ["relevance", "price_asc", "price_desc", "rating"]) {
      expect((await fetchListing(`q=lamp&sort=${sort}`)).toSorted(), sort).toEqual(matches)
    }
  })
})
