/**
 * REQUIREMENTS_3.md: "The product management system allows CRUD operations
 * for products with all required fields.
 *
 *   Admins can add, edit, delete, update and manage products, caregories,
 *   orders and refunds"
 *
 * Every call here is made by an account with the admin role, 2FA on.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { Shop } from "../../apps/api/tests/support/commerce.ts"
import { jsonOf, seedCatalog, startHarness, type Harness } from "../../apps/api/tests/support/harness.ts"
import { Staff, type TestAccount } from "../../apps/api/tests/support/staff.ts"
import { Purchase } from "./support/purchase.ts"

let harness: Harness
let admin: TestAccount
let lamps: string
let acme: string

beforeAll(async () => {
  harness = await startHarness()
}, 180_000)

afterAll(async () => {
  await harness.stop()
})

beforeEach(async () => {
  await harness.reset()
  await seedCatalog(harness, [{ slug: "desk-lamp", name: "Desk Lamp", priceCents: 2500, stock: 50, category: "Lamps", brand: "Acme" }])
  admin = await Staff.account(harness, "admin@example.com", ["admin"])
  const [category] = await harness.database.sql`SELECT id FROM category WHERE slug = 'lamps'`
  const [brand] = await harness.database.sql`SELECT id FROM brand WHERE slug = 'acme'`
  lamps = String(category?.["id"])
  acme = String(brand?.["id"])
})

const call = (method: "GET" | "POST" | "PUT" | "DELETE", url: string, payload?: object) => Staff.call(harness, admin, method, url, payload)

/** Every field a product has, as the admin's form sends it. */
const product = () => ({
  name: "Floor Lamp",
  slug: "floor-lamp",
  description: "Tall and bright, with a dimmer on the cord.",
  priceCents: 8900,
  stock: 4,
  categoryId: lamps,
  brandId: acme,
  weightGrams: 3200,
  widthMm: 300,
  heightMm: 1500,
  depthMm: 300,
  properties: [{ name: "Color", value: "Black" }],
  isFeatured: true,
})

type OrderDetail = { status: string; canRefund: boolean; payment?: { refund?: string } }

const orderOf = async (orderId: string): Promise<OrderDetail> =>
  jsonOf(await call("GET", `/admin/orders/${orderId}`)) as unknown as OrderDetail

describe("products", () => {
  it("are created with every field, read back, edited and deleted", async () => {
    const created = await call("POST", "/admin/products", product())
    const id = String(jsonOf(created)["id"])

    expect(created.statusCode).toBe(201)
    expect(jsonOf(await call("GET", `/admin/products/${id}`))).toMatchObject(product())
    expect(jsonOf(await Shop.call(harness, "GET", "/products/floor-lamp"))).toMatchObject({
      name: "Floor Lamp",
      priceCents: 8900,
      stock: 4,
      category: { slug: "lamps" },
      brand: { slug: "acme" },
      properties: [{ name: "Color", value: "Black" }],
      weight: { grams: 3200 },
    })

    const edited = await call("PUT", `/admin/products/${id}`, {
      ...product(),
      name: "Arc Lamp",
      priceCents: 9900,
      stock: 6,
      stockBefore: 4,
    })
    expect(jsonOf(edited)).toMatchObject({ name: "Arc Lamp", priceCents: 9900, stock: 6 })

    expect((await call("DELETE", `/admin/products/${id}`)).statusCode).toBe(204)
    expect((await call("GET", `/admin/products/${id}`)).statusCode).toBe(404)
    expect((await Shop.call(harness, "GET", "/products/floor-lamp")).statusCode).toBe(404)
  })

  it.each(["name", "slug", "description", "priceCents", "stock", "categoryId", "brandId", "weightGrams", "widthMm", "heightMm", "depthMm"])(
    "are refused without the required %s, named in the answer",
    async (field) => {
      const response = await call("POST", "/admin/products", { ...product(), [field]: undefined })

      expect(response.statusCode).toBe(422)
      expect(jsonOf(response)["error"]).toMatchObject({ issues: [expect.objectContaining({ path: field })] })
      expect(await harness.database.sql`SELECT slug FROM product WHERE slug = 'floor-lamp'`).toHaveLength(0)
    },
  )
})

describe("categories", () => {
  it("are created, renamed and deleted", async () => {
    const created = await call("POST", "/admin/categories", { slug: "rugs", name: "Rugs", description: "Soft underfoot." })
    const id = String(jsonOf(created)["id"])
    const renamed = await call("PUT", `/admin/categories/${id}`, { slug: "rugs", name: "Rugs and mats", description: "Soft underfoot." })
    const listed = jsonOf(await Shop.call(harness, "GET", "/categories"))["items"] as { slug: string; name: string }[]

    expect(created.statusCode).toBe(201)
    expect(jsonOf(renamed)).toMatchObject({ slug: "rugs", name: "Rugs and mats" })
    expect(listed).toContainEqual(expect.objectContaining({ slug: "rugs", name: "Rugs and mats" }))
    expect((await call("DELETE", `/admin/categories/${id}`)).statusCode).toBe(204)
    expect((jsonOf(await Shop.call(harness, "GET", "/categories"))["items"] as { slug: string }[]).map((item) => item.slug)).toEqual([
      "lamps",
    ])
  })
})

describe("orders and refunds", () => {
  it("lists every order and opens one", async () => {
    const placed = await Purchase.placePaid(harness, {}, "desk-lamp")

    const list = jsonOf(await call("GET", "/admin/orders"))["items"] as { id: string; status: string }[]

    expect(list).toEqual([expect.objectContaining({ id: placed.orderId, status: "payment_successful" })])
    expect(await orderOf(placed.orderId)).toMatchObject({ status: "payment_successful" })
  })

  it("moves an order along to delivered, then refunds it in full", async () => {
    const placed = await Purchase.placePaid(harness, {}, "desk-lamp")
    await Purchase.deliver(harness, admin, placed.orderId)
    expect(await orderOf(placed.orderId)).toMatchObject({ status: "delivered", canRefund: true })

    const refund = await call("POST", `/admin/orders/${placed.orderId}/refund`)
    await harness.settle()

    expect(refund.statusCode).toBe(200)
    expect(await orderOf(placed.orderId)).toMatchObject({ status: "refunded", canRefund: false, payment: { refund: "succeeded" } })
    expect(harness.gateway.calls.refund).toEqual([expect.objectContaining({ amountCents: placed.charge.amountCents })])
  })

  it("cancels a paid order, which refunds it and puts the stock back", async () => {
    const placed = await Purchase.placePaid(harness, {}, "desk-lamp")
    expect(await Shop.stockOf(harness, "desk-lamp")).toBe(49)

    const cancel = await call("POST", `/admin/orders/${placed.orderId}/cancel`)
    await harness.settle()

    expect(cancel.statusCode).toBe(200)
    expect(await orderOf(placed.orderId)).toMatchObject({ status: "canceled", payment: { refund: "succeeded" } })
    expect(await Shop.stockOf(harness, "desk-lamp")).toBe(50)
  })
})
