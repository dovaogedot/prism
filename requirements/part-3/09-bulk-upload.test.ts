/**
 * REQUIREMENTS_3.md: "Platform supports bulk upload products via JSON/CSV
 * files."
 */

import { randomBytes } from "node:crypto"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { Shop } from "../../apps/api/tests/support/commerce.ts"
import { jsonOf, seedCatalog, startHarness, type Harness } from "../../apps/api/tests/support/harness.ts"
import { Staff, type TestAccount } from "../../apps/api/tests/support/staff.ts"

let harness: Harness
let admin: TestAccount

beforeAll(async () => {
  harness = await startHarness()
}, 180_000)

afterAll(async () => {
  await harness.stop()
})

beforeEach(async () => {
  await harness.reset()
  await seedCatalog(harness, [{ slug: "desk-lamp", name: "Desk Lamp", priceCents: 2500, stock: 10, category: "Lamps", brand: "Acme" }])
  admin = await Staff.account(harness, "admin@example.com", ["admin"])
})

/** Uploads `text` as the import file `filename` of `type`, as the admin's import page does. */
const upload = (text: string, filename: string, type: string, isDryRun = false) => {
  const boundary = `prism${randomBytes(8).toString("hex")}`
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${type}\r\n\r\n`),
    Buffer.from(text),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ])

  return harness.app.inject({
    method: "POST",
    url: `/api/v1/admin/products/import?dryRun=${isDryRun}`,
    headers: { authorization: `Bearer ${admin.accessToken}`, "content-type": `multipart/form-data; boundary=${boundary}` },
    payload: body,
  })
}

/** A product as the storefront serves it. */
const productOf = async (slug: string) => jsonOf(await Shop.call(harness, "GET", `/products/${slug}`))

describe("a CSV file", () => {
  it("creates new products and updates existing ones, properties included", async () => {
    const csv = [
      "slug,name,description,price,stock,category,brand,weight_g,width_mm,height_mm,depth_mm,featured,property:Color",
      "table-lamp,Table Lamp,A lamp for the bedside table.,19.90,5,lamps,acme,500,100,200,100,false,Red",
      "desk-lamp,Desk Lamp,A brass desk lamp.,29.90,12,lamps,acme,900,150,400,150,true,Brass",
    ].join("\n")

    const response = await upload(csv, "lamps.csv", "text/csv")

    expect(jsonOf(response)).toEqual({ dryRun: false, created: 1, updated: 1, issues: [] })
    expect(await productOf("table-lamp")).toMatchObject({
      name: "Table Lamp",
      priceCents: 1990,
      stock: 5,
      properties: [{ name: "Color", value: "Red" }],
    })
    expect(await productOf("desk-lamp")).toMatchObject({ priceCents: 2990, stock: 12, properties: [{ name: "Color", value: "Brass" }] })
  })
})

describe("a JSON file", () => {
  it("creates new products and updates existing ones, properties included", async () => {
    const json = JSON.stringify([
      {
        slug: "wall-lamp",
        name: "Wall Lamp",
        description: "A lamp that hangs on the wall.",
        priceCents: 4500,
        stock: 7,
        category: "lamps",
        brand: "acme",
        weightGrams: 800,
        widthMm: 120,
        heightMm: 300,
        depthMm: 180,
        featured: false,
        properties: { Color: "White" },
      },
      {
        slug: "desk-lamp",
        name: "Desk Lamp",
        description: "A brass desk lamp.",
        priceCents: 3100,
        stock: 3,
        category: "lamps",
        brand: "acme",
        weightGrams: 900,
        widthMm: 150,
        heightMm: 400,
        depthMm: 150,
        properties: {},
      },
    ])

    const response = await upload(json, "lamps.json", "application/json")

    expect(jsonOf(response)).toEqual({ dryRun: false, created: 1, updated: 1, issues: [] })
    expect(await productOf("wall-lamp")).toMatchObject({
      name: "Wall Lamp",
      priceCents: 4500,
      stock: 7,
      properties: [{ name: "Color", value: "White" }],
    })
    expect(await productOf("desk-lamp")).toMatchObject({ priceCents: 3100, stock: 3 })
  })
})

describe("a file with a mistake", () => {
  it("is checked first, names the row and column, and writes nothing", async () => {
    const csv = [
      "slug,name,description,price,stock,category,brand,weight_g,width_mm,height_mm,depth_mm",
      "table-lamp,Table Lamp,A lamp for the bedside table.,19.90,5,lamps,acme,500,100,200,100",
      "rug,Rug,A soft rug.,49.00,2,rugs,acme,2000,1600,10,2300",
    ].join("\n")

    const checked = await upload(csv, "lamps.csv", "text/csv", true)
    const imported = await upload(csv, "lamps.csv", "text/csv")

    expect(jsonOf(checked)).toMatchObject({ dryRun: true, issues: [{ row: 3, column: "category" }] })
    expect(imported.statusCode).toBe(422)
    expect(await harness.database.sql`SELECT slug FROM product ORDER BY slug`).toEqual([{ slug: "desk-lamp" }])
  })
})
