/**
 * REQUIREMENTS_1.md: "The product data model includes all required fields:
 * `id`, `name`, `description`, `price`, `stock quantity`, `category`,
 * `brand`, `images`, and `weight/dimensions` (in both metric and imperial
 * units)."
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { jsonOf, seedCatalog, startHarness, type Harness } from "../../apps/api/tests/support/harness.ts"

let harness: Harness

beforeAll(async () => {
  harness = await startHarness()
  // The seed gives every product 1000 g and 254 x 127 x 25 mm.
  await seedCatalog(harness, [
    {
      slug: "desk-lamp",
      name: "Desk Lamp",
      description: "A brass lamp for a desk.",
      priceCents: 2499,
      stock: 7,
      category: "Lighting",
      brand: "Acme",
      images: ["desk-lamp-front.png", "desk-lamp-side.png"],
    },
  ])
}, 180_000)

afterAll(async () => {
  await harness.stop()
})

describe("a product", () => {
  it("carries every required field, its weight and size in both metric and imperial units", async () => {
    const response = await harness.app.inject({ method: "GET", url: "/api/v1/products/desk-lamp" })
    const product = jsonOf(response)

    expect(response.statusCode).toBe(200)
    expect(product["id"]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
    expect(product).toMatchObject({
      name: "Desk Lamp",
      description: "A brass lamp for a desk.",
      priceCents: 2499,
      stock: 7,
      category: { slug: "lighting", name: "Lighting" },
      brand: { slug: "acme", name: "Acme" },
      images: [{ url: "/media/desk-lamp-front.png" }, { url: "/media/desk-lamp-side.png" }],
      weight: { grams: 1000, ounces: 35.27 },
      dimensions: {
        millimeters: { width: 254, height: 127, depth: 25 },
        inches: { width: 10, height: 5, depth: 0.98 },
      },
    })
  })

  it("is stored with those fields as columns, each required", async () => {
    const required = await harness.database.sql<{ column: string }[]>`
      SELECT column_name AS column FROM information_schema.columns
      WHERE table_name = 'product' AND is_nullable = 'NO'`
    const imageColumns = await harness.database.sql<{ column: string }[]>`
      SELECT column_name AS column FROM information_schema.columns WHERE table_name = 'product_image'`

    expect(required.map((row) => row.column)).toEqual(
      expect.arrayContaining([
        "id",
        "name",
        "description",
        "price_cents",
        "stock",
        "category_id",
        "brand_id",
        "weight_grams",
        "width_mm",
        "height_mm",
        "depth_mm",
      ]),
    )
    expect(imageColumns.map((row) => row.column)).toEqual(expect.arrayContaining(["product_id", "file", "alt", "position"]))
  })
})
