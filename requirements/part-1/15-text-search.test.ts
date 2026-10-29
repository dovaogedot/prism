/**
 * REQUIREMENTS_1.md: "Student can demonstrate and explain the search
 * implementation including database design and basic text search
 * functionality."
 *
 * The demonstrable part: what a text search finds and in what order, and the
 * indexes the database answers it from. The explanation is the student's.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { jsonOf, seedCatalog, startHarness, type Harness } from "../../apps/api/tests/support/harness.ts"

let harness: Harness

/** One page of results, as far as these checks read it. */
type Results = { matched: string; total: number; items: { slug: string }[] }

beforeAll(async () => {
  harness = await startHarness()
  await seedCatalog(harness, [
    { slug: "lamp-shade", name: "Lamp Shade", description: "Linen, for any lamp.", priceCents: 1500 },
    { slug: "desk-lamp", name: "Desk Lamp", description: "A brass lamp for a desk.", priceCents: 2500 },
    { slug: "lamp", name: "Lamp", description: "Just a lamp.", priceCents: 1900 },
    { slug: "oak-desk", name: "Oak Desk", description: "Solid oak.", priceCents: 30_000 },
    { slug: "diamond-sword", name: "Diamond Sword", description: "The strongest sword.", priceCents: 1600 },
    { slug: "iron-sword", name: "Iron Sword", description: "A dependable sword.", priceCents: 1400 },
  ])
}, 180_000)

afterAll(async () => {
  await harness.stop()
})

const search = async (text: string): Promise<Results> =>
  jsonOf(await harness.app.inject({ method: "GET", url: `/api/v1/products?q=${encodeURIComponent(text)}&perPage=60` })) as Results

const listSlugs = (results: Results): string[] => results.items.map((item) => item.slug)

describe("text search", () => {
  it("finds the products whose name holds the word, and only those", async () => {
    expect(listSlugs(await search("sword")).toSorted()).toEqual(["diamond-sword", "iron-sword"])
  })

  it("finds a product by a word of its description", async () => {
    expect(listSlugs(await search("brass"))).toEqual(["desk-lamp"])
  })

  it("puts the product named exactly what was typed first", async () => {
    const lamps = await search("lamp")

    expect(listSlugs(lamps)[0]).toBe("lamp")
    expect(listSlugs(lamps).toSorted()).toEqual(["desk-lamp", "lamp", "lamp-shade"])
  })

  it("finds the product a misspelled name means, and says the match is a similar one", async () => {
    const typo = await search("diamnd sword")

    expect(typo.matched).toBe("similar")
    expect(listSlugs(typo)[0]).toBe("diamond-sword")
    expect((await search("diamond sword")).matched).toBe("exact")
  })

  it("is answered from a full-text index of the products' words and a trigram index of their names", async () => {
    const indexes = (await harness.database.sql<{ indexdef: string }[]>`SELECT indexdef FROM pg_indexes WHERE tablename = 'product'`).map(
      (row) => row.indexdef,
    )
    const [definition] = await harness.database.sql<{ type: string; expression: string }[]>`
      SELECT data_type AS type, generation_expression AS expression
      FROM information_schema.columns WHERE table_name = 'product' AND column_name = 'search'`

    expect(definition?.type).toBe("tsvector")
    expect(definition?.expression).toMatch(/to_tsvector\('english'::regconfig, name\).*to_tsvector\('english'::regconfig, description\)/)
    expect(indexes).toContainEqual(expect.stringMatching(/USING gin \(search\)/))
    expect(indexes).toContainEqual(expect.stringMatching(/USING gin \(name gin_trgm_ops\)/))
  })
})
