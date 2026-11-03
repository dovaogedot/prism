import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { Archive } from "../archive.ts"
import { SeedCatalog, SeedProduct } from "../seed-catalog.ts"

describe("SeedProduct.schema", () => {
  const recharge = (value: string): string | undefined =>
    SeedProduct.schema.parse({ name: "Kidney Bean", description: "", priceCents: 100, image: "a.png", properties: { recharge: value } })
      .properties["recharge"]

  it("spells a count of rooms one way, whatever case and plural its source wrote", () => {
    expect(["1 Rooms", "1 room", "4 Rooms", "4 rooms", "2 room"].map(recharge)).toEqual([
      "1 room",
      "1 room",
      "4 rooms",
      "4 rooms",
      "2 rooms",
    ])
  })

  it("keeps every other value as it is", () => {
    expect(["12 rooms (one time use)", "Instant", "5 seconds"].map(recharge)).toEqual(["12 rooms (one time use)", "Instant", "5 seconds"])
  })
})

describe("the archived catalog", () => {
  it("spells each value of a property one way, so its filter lists the value once", () => {
    const catalog = SeedCatalog.schema.parse(
      JSON.parse(new TextDecoder().decode(Archive.read(readFileSync(new URL("../data.zip", import.meta.url)), "catalog.json"))),
    )
    const spellings = new Map<string, Set<string>>()

    for (const product of catalog.categories.flatMap((category) => category.products)) {
      for (const [name, value] of Object.entries(product.properties)) {
        // Case and a plural "s" are what tell two spellings of one value apart.
        const key = `${name}: ${value.toLowerCase().replace(/s\b/g, "")}`
        spellings.set(key, new Set([...(spellings.get(key) ?? []), value]))
      }
    }

    expect([...spellings.values()].filter((values) => values.size > 1).map((values) => [...values])).toEqual([])
  })
})
